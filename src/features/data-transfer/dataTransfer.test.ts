import { buildLastLayerCatalogueTarget } from "../../cube/lastLayerTraining";
import { analyseSolve } from "../../cube/analysis";
import { Alg } from "cubing/alg";
import { catalogueIdentityForTarget, trainingCatalogueKey } from "../../app/trainingCatalogue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../../cube/puzzle";
import { DEFAULT_EVENT_ID } from "../../cube/scramble";
import * as db from "../../infrastructure/persistence/db";
import * as transfer from "./dataTransfer";
import * as solveCsv from "./solveCsv";
import { deriveStatistics } from "../statistics/state/statistics";
import { formatSolveCsv, parseSolveCsv } from "./solveCsv";
import type { SessionContext } from "../sessions/sessionService";
import type { Session, Solve, TrainingAttempt, TrainingDrillPreset, TrainingAlgorithmPreference } from "../../app/types";

const kpuzzle = await get3x3x3();
const session = (id: string, event: Session["event"] = DEFAULT_EVENT_ID): Session =>
  ({ id, name: id, event, createdAt: 0 });
const solveFor = (sessionId: string, id = `solve-${sessionId}`): Solve => ({
  id, sessionId, createdAt: 0, rawMs: 1000, penalty: "none", scramble: "R U", source: "keyboard", moves: [],
});
const previous: SessionContext = { sessions: [session("A")], sessionId: "A", solves: [] };
const jsonExport = (sessions: unknown[], solves: unknown[] = []) =>
  JSON.stringify({ format: "cubetimer", version: 2, sessions, solves });

/** Model adapter upserts so repeat-import tests exercise stable persisted identities. */
function storage(sessions: Session[] = previous.sessions, solves: Solve[] = [], attempts: TrainingAttempt[] = [], presets: TrainingDrillPreset[] = [], preferences: TrainingAlgorithmPreference[] = []) {
  const recognitionStore = new Map<string, import("../../app/types").TrainingRecognitionAttempt>();
  vi.spyOn(db, "loadTrainingRecognitionAttempts").mockImplementation(async () => [...recognitionStore.values()]);
  vi.spyOn(db, "saveTrainingRecognitionAttempt").mockImplementation(async value => { recognitionStore.set(value.id, value); });
  const sessionStore = new Map(sessions.map((value) => [value.id, value]));
  const solveStore = new Map(solves.map((value) => [value.id, value]));
  const preferenceStore = new Map(preferences.map(value => [value.key, value]));
  vi.spyOn(db, "loadTrainingAlgorithmPreferences").mockImplementation(async () => [...preferenceStore.values()]);
  vi.spyOn(db, "saveTrainingAlgorithmPreference").mockImplementation(async value => { preferenceStore.set(value.key, value); });
  const presetStore = new Map(presets.map(value => [value.id, value]));
  vi.spyOn(db, "loadTrainingDrillPresets").mockImplementation(async () => [...presetStore.values()]);
  vi.spyOn(db, "saveTrainingDrillPreset").mockImplementation(async value => { presetStore.set(value.id, value); });
  const attemptStore = new Map(attempts.map(value => [value.id, value]));
  vi.spyOn(db, "loadTrainingAttempts").mockImplementation(async () => [...attemptStore.values()]);
  vi.spyOn(db, "saveTrainingAttempt").mockImplementation(async value => { attemptStore.set(value.id, value); });
  vi.spyOn(db, "loadSessions").mockImplementation(async () => [...sessionStore.values()]);
  vi.spyOn(db, "loadAllSolves").mockImplementation(async () => [...solveStore.values()]);
  vi.spyOn(db, "loadSessionIdsWithSolves").mockImplementation(async () => new Set([...solveStore.values()].map(value => value.sessionId)));
  vi.spyOn(db, "loadExistingSolveOwners").mockImplementation(async ids => new Map(
    [...solveStore.values()].filter(value => ids.has(value.id)).map(value => [value.id, value.sessionId]),
  ));
  vi.spyOn(db, "loadSolves").mockImplementation(async (id) => [...solveStore.values()].filter((value) => value.sessionId === id));
  vi.spyOn(db, "saveSession").mockImplementation(async (value) => { sessionStore.set(value.id, value); });
  vi.spyOn(db, "saveSolve").mockImplementation(async (value) => { solveStore.set(value.id, value); });
  vi.spyOn(db, "saveSolves").mockImplementation(async (values) => { for (const value of values) solveStore.set(value.id, value); });
  return { recognitionStore, sessionStore, solveStore, attemptStore, presetStore, preferenceStore };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("JSON backup workflow", () => {
  it("accepts a partial backup referencing a persisted Session omitted from the file", async () => {
    const { solveStore } = storage();
    const row = solveFor("A");
    const result = await transfer.importData(kpuzzle, previous, jsonExport([], [row]));
    expect(result).toMatchObject({ sessions: 0, solves: 1 });
    expect(solveStore.get(row.id)).toEqual(db.migrateSolve(row));
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.loadExistingSolveOwners).toHaveBeenCalledExactlyOnceWith(new Set([row.id]));
  });

  it.each(["unknown reference", "existing owner", "incoming owners"])("rejects %s before writing any collection", async kind => {
    const local = solveFor("A", "stable");
    const stores = storage([session("A"), session("other", "222")], [local]);
    const settings = vi.spyOn(db, "saveSettings").mockResolvedValue();
    const rows = kind === "unknown reference" ? [solveFor("missing")]
      : kind === "existing owner" ? [solveFor("B", local.id)]
      : [solveFor("B", "duplicate"), solveFor("A", "duplicate")];
    const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", 2);
    const identity = catalogueIdentityForTarget(target.info)!;
    const archive = JSON.stringify({ sessions: [session("B")], solves: rows,
      trainingAttempts: [{ id: "training", createdAt: 0, mode: "virtual", target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 1", position: "FR" },
        moves: [], stm: 0, elapsedMs: 0, recommendedStm: null, matchedReferenceRank: null, delta: null }],
      trainingRecognitionAttempts: [{ id: "recognition", createdAt: 0, drillRunId: "run", drillRound: 1,
        target: { family: "pll", trainingSet: "full", caseId: "T" }, answerCaseId: "T", responseMs: 1 }],
      trainingDrillPresets: [{ id: "preset", name: "Preset", createdAt: 0, updatedAt: 0, context: { family: "pll", trainingSet: "full" }, caseIds: ["T"], strategy: "random" }],
      trainingAlgorithmPreferences: [{ key: trainingCatalogueKey(identity), target: identity, algorithm: target.info.references[0].sourceAlg,
        source: "catalog", note: null, createdAt: 0, updatedAt: 0 }],
    });
    await expect(transfer.importData(kpuzzle, previous, archive)).rejects.toThrow(kind === "unknown reference"
      ? /references a Session that does not exist/ : kind === "existing owner" ? /already belongs to another Session/ : /conflicting Sessions/);
    for (const writing of [db.saveSession, db.saveSolve, db.saveSolves, db.saveTrainingAttempt,
      db.saveTrainingRecognitionAttempt, db.saveTrainingDrillPreset, db.saveTrainingAlgorithmPreference, settings]) {
      expect(writing).not.toHaveBeenCalled();
    }
    expect([...stores.sessionStore.keys()]).toEqual(["A", "other"]);
    expect([...stores.solveStore.values()]).toEqual([local]);
    expect(db.loadAllSolves).not.toHaveBeenCalled();
  });

  it("retains last-write upsert semantics for repeated IDs with the same incoming owner", async () => {
    const { solveStore } = storage();
    await transfer.importData(kpuzzle, previous, jsonExport([], [solveFor("A"), { ...solveFor("A"), rawMs: 2000 }]));
    expect(solveStore.size).toBe(1);
    expect(solveStore.get("solve-A")?.rawMs).toBe(2000);
  });
  it.each([1, 401])("imports %s Solves with bounded batches and stable upserts", async count => {
    const { solveStore } = storage(previous.sessions, [{ ...solveFor("A", "row-0"), rawMs: 9999 }]);
    const rows = Array.from({ length: count }, (_, i) => ({ ...solveFor("A", `row-${i}`), rawMs: 1000 + i }));
    const archive = jsonExport(previous.sessions, rows);
    const result = await transfer.importData(kpuzzle, previous, archive);
    expect(result).toMatchObject({ solves: count, sessions: 1, trainingAttempts: 0, trainingRecognitionAttempts: 0,
      trainingDrillPresets: 0, trainingAlgorithmPreferences: 0, context: { sessionId: "A", eventChanged: false } });
    expect(result.context.solves).toEqual(rows.map(db.migrateSolve));
    const batches = vi.mocked(db.saveSolves).mock.calls.map(([batch]) => batch);
    expect(batches.map(batch => batch.length)).toEqual(count === 1 ? [1] : [200, 200, 1]);
    expect(batches.flat()).toEqual(rows.map(db.migrateSolve));
    expect(vi.mocked(db.saveSession).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(db.saveSolves).mock.invocationCallOrder[0]);
    expect(solveStore.get("row-0")?.rawMs).toBe(1000);
    await transfer.importData(kpuzzle, result.context, archive);
    expect(solveStore.size).toBe(count);
    expect([...solveStore.values()]).toEqual(rows.map(db.migrateSolve));
    expect(db.saveSolve).not.toHaveBeenCalled();
    expect(db.loadAllSolves).not.toHaveBeenCalled();
    expect(db.loadSessionIdsWithSolves).toHaveBeenCalledTimes(2);
  });

  it("does not write an empty Solve collection", async () => {
    storage();
    expect(await transfer.importData(kpuzzle, previous, jsonExport([]))).toMatchObject({ solves: 0, context: { sessionId: "A" } });
    expect(db.saveSolves).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled();
  });

  it("propagates batch failure before later collections or context reload", async () => {
    storage();
    const error = new Error("Import write failed");
    vi.mocked(db.saveSolves).mockRejectedValueOnce(error);
    await expect(transfer.importData(kpuzzle, previous, jsonExport(previous.sessions, [solveFor("A")]))).rejects.toBe(error);
    expect(db.loadSessions).toHaveBeenCalledOnce();
    expect(db.loadSolves).not.toHaveBeenCalled();
    expect(db.saveTrainingAttempt).not.toHaveBeenCalled();
    expect(db.saveTrainingRecognitionAttempt).not.toHaveBeenCalled();
    expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled();
    expect(db.saveTrainingAlgorithmPreference).not.toHaveBeenCalled();
  });

  it("round-trips correction overlays through JSON v7 and migration without adding them to CSV", async () => {
    const solution = new Alg("R U R' U R U2 R'");
    const moves = Array.from(solution.childAlgNodes()).map((node, i) => ({ move: node.toString(), t: (i + 1) * 200 }));
    const start = kpuzzle.defaultPattern().applyAlg(solution.invert());
    const analysis = analyseSolve(start, moves, null, { observedStartBottomFace: "L", trackedBottomFace: "D" })!;
    const candidate = analyseSolve(start, moves, null, {})!;
    const original: Solve = { ...solveFor("A"), source: "smartcube", scramble: solution.invert().toString(), moves, analysis,
      solveStartBottomFace: "L", gripTrack: `|${"LF".repeat(moves.length)}`, cfopAnalysisExcluded: true,
      cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 321, analysis: candidate } };
    const { solveStore } = storage([session("A")], [original]);
    const exported = await transfer.exportData();
    expect(JSON.parse(exported)).toMatchObject({ version: 7, solves: [original] });
    solveStore.clear();
    await transfer.importData(kpuzzle, previous, exported);
    expect(solveStore.get(original.id)).toEqual(original);
    const { cfopAnalysisCorrection: _correction, ...without } = original;
    expect(formatSolveCsv([original], new Map())).toBe(formatSolveCsv([without], new Map()));
  });
  it("imports v3 history as Single/null and exports current Drill fields in v7, keeping stable IDs", async () => {
    const old = { id: "old-training", createdAt: 10, mode: "virtual",
      target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 4", position: "FR" },
      moves: ["R"], stm: 1, elapsedMs: 0, recommendedStm: 1, matchedReferenceRank: 1, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: 0 };
    const { attemptStore } = storage();
    const v3 = JSON.stringify({ version: 3, sessions: [], solves: [], trainingAttempts: [old] });
    await transfer.importData(kpuzzle, previous, v3);
    expect(attemptStore.get(old.id)).toEqual({ ...old, activity: "single", drillRunId: null, drillRound: null, caseTimeMs: null });
    const drill = { ...old, id: "drill", activity: "drill", drillRunId: null, drillRound: null, caseTimeMs: 2100 };
    const v4 = JSON.stringify({ version: 4, sessions: [], solves: [], trainingAttempts: [drill] });
    await transfer.importData(kpuzzle, previous, v4); await transfer.importData(kpuzzle, previous, v4);
    expect(attemptStore.size).toBe(2);
    expect(JSON.parse(await transfer.exportData())).toMatchObject({ version: 7, trainingAttempts: [
      { ...old, activity: "single", drillRunId: null, drillRound: null, caseTimeMs: null }, drill,
    ] });
  });
  it("exports version 7 with solve, Training and preset records", async () => {
    const sessions = [session("A", "222")];
    const solves = [solveFor("A")];
    storage(sessions, solves);
    vi.spyOn(Date, "now").mockReturnValue(1234);
    expect(JSON.parse(await transfer.exportData())).toEqual({
      format: "cubetimer", version: 7, exportedAt: 1234, sessions, solves, trainingAttempts: [], trainingDrillPresets: [], trainingAlgorithmPreferences: [], trainingRecognitionAttempts: [],
    });
  });

  it("normalizes legacy records, skips invalid records, and preserves stable IDs on repeated imports", async () => {
    const { sessionStore, solveStore } = storage([]);
    const archive = jsonExport([
      { id: "legacy", name: "Legacy", createdAt: 0 }, null, { id: "invalid" },
    ], [
      { ...solveFor("legacy"), event: "222", moves: undefined, analysis: { cross: "obsolete" } },
      null, { id: "invalid", sessionId: "legacy", rawMs: "bad" },
    ]);
    const result = await transfer.importData(kpuzzle, previous, archive);
    expect(result).toEqual({
      sessions: 1, solves: 1, trainingAttempts: 0, trainingRecognitionAttempts: 0, trainingDrillPresets: 0, trainingAlgorithmPreferences: 0,
      context: { sessions: [sessionStore.get("legacy")], sessionId: "legacy", solves: [solveStore.get("solve-legacy")], eventChanged: false },
    });
    expect(sessionStore.get("legacy")).toMatchObject({ event: DEFAULT_EVENT_ID });
    expect(solveStore.get("solve-legacy")).toMatchObject({ moves: [], analysis: null });
    expect(solveStore.get("solve-legacy")).not.toHaveProperty("event");
    await transfer.importData(kpuzzle, result.context, archive);
    expect(sessionStore.size).toBe(1);
    expect(solveStore.size).toBe(1);
    await transfer.importData(kpuzzle, result.context, jsonExport([sessionStore.get("legacy")], [{ ...solveFor("legacy"), rawMs: 2000 }]));
    expect(solveStore.get("solve-legacy")?.rawMs).toBe(2000);
    expect(solveStore.size).toBe(1);
  });

  it.each(["existing", "incoming"])("rejects JSON event conflicts before any writes when %s history exists", async (history) => {
    storage(previous.sessions, history === "existing" ? [solveFor("A")] : []);
    await expect(transfer.importData(kpuzzle, previous, jsonExport([
      session("B"), session("A", "222"),
    ], history === "incoming" ? [solveFor("A")] : []))).rejects.toThrow(/Cannot merge session/);
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled();
    expect(db.saveSolves).not.toHaveBeenCalled();
  });

  it("rejects conflicting incoming definitions before writing", async () => {
    storage([]);
    await expect(transfer.importData(kpuzzle, previous, jsonExport([session("B"), session("B", "222")]))).rejects.toThrow(/conflicting events/);
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled();
    expect(db.saveSolves).not.toHaveBeenCalled();
  });

  it("returns the selected imported event transition and retains selection over newer Sessions", async () => {
    storage();
    const result = await transfer.importData(kpuzzle, previous, jsonExport([session("A", "222"), session("B")]));
    expect(result.context.sessionId).toBe("A");
    expect(result.context.eventChanged).toBe(true);
    expect(result.context.solves).toEqual([]);
  });

  it("imports current Training facts, skips malformed records and upserts IDs even without their source Solve", async () => {
    const attempt: TrainingAttempt = { id: "attempt", createdAt: 10, mode: "virtual", activity: "single", drillRunId: null, drillRound: null, caseTimeMs: null,
      target: { family: "oll", origin: "solve-step", solveId: "missing", stepName: "OLL", trainingSet: "full", caseId: "27", auf: 2 },
      moves: ["R", "U"], stm: 2, elapsedMs: 700, recommendedStm: 2, matchedReferenceRank: 1, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: 0 };
    const { attemptStore } = storage();
    const archive = JSON.stringify({ format: "cubetimer", version: 4, sessions: previous.sessions, solves: [], trainingAttempts: [
      attempt, null, { ...attempt, id: "bad", stm: "2" }, { ...attempt, id: "bad-mode", mode: "timer" },
    ] });
    const result = await transfer.importData(kpuzzle, previous, archive);
    expect(result).toMatchObject({ trainingAttempts: 1, solves: 0, sessions: 1 });
    expect(attemptStore.get("attempt")).toEqual(attempt);
    await transfer.importData(kpuzzle, result.context, archive);
    expect(attemptStore.size).toBe(1);
    expect(JSON.parse(await transfer.exportData()).trainingAttempts).toEqual([attempt]);
  });

  it("keeps Training independent of Session compatibility and leaves existing Training history on v2 import", async () => {
    const attempt: TrainingAttempt = { id: "global", createdAt: 0, mode: "setup", activity: "single", drillRunId: null, drillRound: null, caseTimeMs: null,
      target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 1", position: "FR" },
      moves: ["R"], stm: 1, elapsedMs: 0, recommendedStm: null, matchedReferenceRank: null, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: null };
    const { attemptStore } = storage(previous.sessions, [], [attempt]);
    expect(await transfer.importData(kpuzzle, previous, jsonExport([]))).toMatchObject({ trainingAttempts: 0 });
    expect(attemptStore.size).toBe(1);
    // No source Solve or Session is required for an exact historical attempt.
    const exact = { ...attempt, target: { family: "f2l", origin: "solve-step", solveId: "absent", stepName: "F2L Slot 1", position: "FR" } };
    const result = await transfer.importData(kpuzzle, previous, JSON.stringify({ sessions: [], solves: [], trainingAttempts: [exact] }));
    expect(result.trainingAttempts).toBe(1);
    expect(attemptStore.get("global")?.target.origin).toBe("solve-step");
  });

  it("retains malformed-export error semantics without writes", async () => {
    storage();
    await expect(transfer.importData(kpuzzle, previous, "{broken")).rejects.toBeInstanceOf(SyntaxError);
    await expect(transfer.importData(kpuzzle, previous, '{"sessions":[]}')).rejects.toThrow("This does not look like a cubetimer export.");
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled();
    expect(db.saveSolves).not.toHaveBeenCalled();
  });
});

describe("solve-analysis CSV workflow", () => {
  const imported = { ...session("import:Imported"), name: "Imported" };
  const csvFor = (solves = [solveFor(imported.id)]) =>
    formatSolveCsv(solves, new Map([[imported.id, imported.name]]));

  it("enforces reference integrity even if parsed CSV output is missing its Session", async () => {
    // The current CSV parser normally supplies a Session for every accepted row.
    storage();
    vi.spyOn(solveCsv, "solveCsvBatches").mockImplementation(function* () {
      yield { sessions: [], solves: [solveFor("unknown")], skipped: [] };
    });
    await expect(transfer.importSolveCsv(kpuzzle, previous, csvFor())).rejects.toThrow("Session that does not exist");
    expect(db.saveSession).not.toHaveBeenCalled(); expect(db.saveSolves).not.toHaveBeenCalled();
  });

  it.each(["existing", "incoming"])("rejects %s ownership conflicts in the last CSV batch before all writes", async kind => {
    const local = solveFor("A", "collision");
    const { solveStore, sessionStore } = storage(previous.sessions, [local]);
    const rows = Array.from({ length: 200 }, (_, i) => solveFor(imported.id, `row-${i}`));
    rows.push(solveFor("another", kind === "existing" ? local.id : "row-0"));
    const csv = formatSolveCsv(rows, new Map([[imported.id, imported.name], ["another", "Another"]]));
    const progress = vi.fn();
    await expect(transfer.importSolveCsv(kpuzzle, previous, csv, progress)).rejects.toThrow(
      kind === "existing" ? /already belongs to another Session/ : /conflicting Sessions/);
    expect(db.saveSession).not.toHaveBeenCalled(); expect(db.saveSolves).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled(); expect(db.saveTrainingAttempt).not.toHaveBeenCalled();
    expect(db.saveTrainingRecognitionAttempt).not.toHaveBeenCalled(); expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled();
    expect(db.saveTrainingAlgorithmPreference).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
    expect([...solveStore.values()]).toEqual([local]); expect([...sessionStore.values()]).toEqual(previous.sessions);
    expect(db.loadAllSolves).not.toHaveBeenCalled();
  });

  it("keeps CSV same-ID/same-Session upserts compatible with existing history", async () => {
    const existing = solveFor(imported.id);
    const { solveStore } = storage([imported], [existing]);
    const csv = csvFor([{ ...existing, rawMs: 2000 }, { ...existing, rawMs: 3000 }]);
    await transfer.importSolveCsv(kpuzzle, previous, csv);
    await transfer.importSolveCsv(kpuzzle, previous, csv);
    expect(solveStore.size).toBe(1); expect(solveStore.get(existing.id)?.rawMs).toBe(3000);
  });

  it("keeps compatible repeat imports idempotent and returns Session/Solve counts", async () => {
    const { sessionStore, solveStore } = storage();
    const progress = vi.fn();
    const result = await transfer.importSolveCsv(kpuzzle, previous, csvFor(), progress);
    expect(result).toMatchObject({ sessions: 1, solves: 1, skipped: { count: 0, sample: [] }, context: { sessionId: "A", eventChanged: false } });
    await transfer.importSolveCsv(kpuzzle, result.context, csvFor());
    expect(sessionStore.size).toBe(2);
    expect(solveStore.size).toBe(1);
    expect(sessionStore.get(imported.id)?.event).toBe(DEFAULT_EVENT_ID);
    expect([...solveStore.values()][0].sessionId).toBe(imported.id);
    expect(progress).toHaveBeenCalledExactlyOnceWith(1, 1);
  });

  it.each([true, false])("rejects CSV event conflicts before writing, including incoming history alone: %s", async (existingHistory) => {
    storage([previous.sessions[0], { ...imported, event: "222" }], existingHistory ? [solveFor(imported.id)] : []);
    await expect(transfer.importSolveCsv(kpuzzle, previous, csvFor())).rejects.toThrow(/Cannot merge session/);
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolves).not.toHaveBeenCalled();
  });

  it("validates later batches before writing any earlier batch", async () => {
    storage([{ ...imported, event: "222" }]);
    const rows = Array.from({ length: 200 }, (_, i) => solveFor("other", `other-${i}`));
    rows.push(solveFor(imported.id));
    const csv = formatSolveCsv(rows, new Map([["other", "Other"], [imported.id, imported.name]]));
    await expect(transfer.importSolveCsv(kpuzzle, previous, csv)).rejects.toThrow(/Cannot merge session/);
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolves).not.toHaveBeenCalled();
  });

  it("reports progress and yields to the browser between 200-row batches", async () => {
    vi.useFakeTimers();
    const { solveStore } = storage();
    const rows = Array.from({ length: 201 }, (_, i) => solveFor(imported.id, `row-${i}`));
    const progress = vi.fn();
    const firstBatch = new Promise<void>((resolve) => {
      progress.mockImplementationOnce(() => resolve());
    });
    const importing = transfer.importSolveCsv(kpuzzle, previous, csvFor(rows), progress);
    await firstBatch;
    expect(progress.mock.calls).toEqual([[200, 201]]);
    expect(solveStore.size).toBe(200);
    await vi.runAllTimersAsync();
    expect(await importing).toMatchObject({ solves: 201, sessions: 1 });
    expect(progress.mock.calls).toEqual([[200, 201], [201, 201]]);
    expect(db.saveSession).toHaveBeenCalledOnce();
  });

  it("rejects an unrelated CSV before writing anything", async () => {
    storage();
    await expect(transfer.importSolveCsv(kpuzzle, previous, "name,score\nAda,3")).rejects.toThrow(
      "This does not look like a solve-analysis CSV export.",
    );
    await expect(transfer.importSolveCsv(kpuzzle, previous, "")).rejects.toThrow(/solve-analysis CSV/);
    expect(db.loadSessions).not.toHaveBeenCalled();
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolves).not.toHaveBeenCalled();
  });

  it("dates each Session by its earliest solve across every batch", async () => {
    const { sessionStore } = storage();
    const rows = Array.from({ length: 401 }, (_, i) => ({ ...solveFor(imported.id, `row-${i}`), createdAt: (500 - i) * 1000 }));
    // The earliest solve sits in the last batch; the first batch starts much later.
    const result = await transfer.importSolveCsv(kpuzzle, previous, csvFor(rows));
    expect(result).toMatchObject({ solves: 401, sessions: 1 });
    expect(sessionStore.get(imported.id)?.createdAt).toBe(100 * 1000);
    expect(db.saveSession).toHaveBeenCalledOnce();
    expect(db.saveSolves).toHaveBeenCalledTimes(3);
    expect(db.saveSolve).not.toHaveBeenCalled();
  });

  it("reports skipped rows and keeps progress totals to the rows it can import", async () => {
    const { solveStore } = storage();
    const rows = [0, 1, 2].map((i) => ({ ...solveFor(imported.id, `row-${i}`), createdAt: (i + 1) * 1000 }));
    const csv = csvFor(rows).replace("1970-01-01 00:00:02 UTC", "not a date");
    const progress = vi.fn();
    const result = await transfer.importSolveCsv(kpuzzle, previous, csv, progress);
    expect(result).toMatchObject({ solves: 2, sessions: 1, skipped: { count: 1, sample: [{ line: 3, reason: "invalid date" }] } });
    expect([...solveStore.keys()]).toEqual(["row-0", "row-2"]);
    expect(progress.mock.calls).toEqual([[2, 2]]);
  });

  it("exports active Session or all persisted Solves, ordered with Session names", async () => {
    const sessions = [session("A"), session("B")];
    const active = { ...solveFor("A"), createdAt: 2000 };
    const other = { ...solveFor("B"), createdAt: 1000 };
    storage(sessions, [active, other]);
    const current = parseSolveCsv(await transfer.exportSolveCsv("session", sessions, [active]));
    expect(current.solves.map((solve) => solve.id)).toEqual([active.id]);
    expect(db.loadAllSolves).not.toHaveBeenCalled();
    const all = parseSolveCsv(await transfer.exportSolveCsv("all", sessions, [active]));
    expect(all.solves.map((solve) => solve.id)).toEqual([other.id, active.id]);
    expect(all.sessions.map((session) => session.name)).toEqual(["B", "A"]);
  });
});

describe("import recovery and event integrity", () => {
  it.each(["json", "csv"])("permits safe retry after a partially committed %s import", async format => {
    const imported = { ...session("import:Imported"), name: "Imported" };
    const { solveStore, sessionStore } = storage();
    const rows = Array.from({ length: 201 }, (_, i) => solveFor(imported.id, `row-${i}`));
    const write = vi.mocked(db.saveSolves);
    const persist = write.getMockImplementation()!;
    write.mockImplementationOnce(persist).mockRejectedValueOnce(new Error("Second batch failed"));
    const document = format === "json" ? jsonExport([imported], rows) : formatSolveCsv(rows, new Map([[imported.id, imported.name]]));
    const run = () => format === "json" ? transfer.importData(kpuzzle, previous, document) : transfer.importSolveCsv(kpuzzle, previous, document);
    await expect(run()).rejects.toThrow("Second batch failed");
    expect(solveStore.size).toBe(200); expect(sessionStore.has(imported.id)).toBe(true);
    expect(await run()).toMatchObject({ solves: 201 });
    expect(solveStore.size).toBe(201); expect(sessionStore.size).toBe(2);
  });

  it("prevents an import collision from leaking another event's history into Statistics", async () => {
    const other = { ...solveFor("other", "stable"), rawMs: 2345 };
    const { solveStore, sessionStore } = storage([session("A"), session("other", "222")], [other]);
    await expect(transfer.importData(kpuzzle, previous, jsonExport([], [solveFor("A", other.id)])))
      .rejects.toThrow("already belongs to another Session");
    const snapshot = { sessions: [...sessionStore.values()], solves: [...solveStore.values()] };
    expect(deriveStatistics(snapshot, { event: "333", sessionId: null }, "A").scopeSolves).toEqual([]);
    expect(deriveStatistics(snapshot, { event: "222", sessionId: null }, "A").scopeSolves).toEqual([other]);
    expect(solveStore.get(other.id)).toBe(other);
  });
});

describe("JSON v5 saved drills", () => {
  const preset: TrainingDrillPreset = { id: "preset", name: "Same name", createdAt: 10, updatedAt: 20,
    context: { family: "oll", trainingSet: "2look" }, caseIds: ["L-Shape"], strategy: "weighted", task: "execution" };
  it("exports all four collections, skips malformed presets, merges by ID and permits duplicate names", async () => {
    const local = { ...preset, id: "local" };
    const { presetStore } = storage(previous.sessions, [], [], [local]);
    const archive = JSON.stringify({ version: 5, sessions: [], solves: [], trainingAttempts: [], trainingDrillPresets: [
      preset, { ...preset, id: "second", context: { family: "pll", trainingSet: "full" }, caseIds: ["T"] },
      null, { ...preset, id: "bad", caseIds: ["27"] },
    ] });
    expect(await transfer.importData(kpuzzle, previous, archive)).toMatchObject({ sessions: 0, solves: 0, trainingAttempts: 0, trainingDrillPresets: 2 });
    await transfer.importData(kpuzzle, previous, archive);
    expect(presetStore.size).toBe(3); expect(presetStore.get(preset.id)).toEqual(preset);
    const exported = JSON.parse(await transfer.exportData());
    expect(exported).toMatchObject({ version: 7, sessions: previous.sessions, solves: [], trainingAttempts: [] });
    expect(exported.trainingDrillPresets).toEqual([...presetStore.values()]);
    expect(new Set(exported.trainingDrillPresets.map((p: TrainingDrillPreset) => p.name)).size).toBe(1);
  });
  it.each([2, 3, 4])("v%s without presets leaves existing saved drills untouched", async version => {
    const { presetStore } = storage(previous.sessions, [], [], [preset]);
    expect(await transfer.importData(kpuzzle, previous, JSON.stringify({ version, sessions: [], solves: [] })))
      .toMatchObject({ trainingDrillPresets: 0 });
    expect([...presetStore.values()]).toEqual([preset]); expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled();
  });
  it("CSV remains Solve-only and does not write or include presets", async () => {
    const imported = { ...session("import:Imported"), name: "Imported" };
    storage([imported], [solveFor(imported.id)], [], [preset]);
    const csv = await transfer.exportSolveCsv("all", [imported], []);
    expect(csv).not.toContain("Same name");
    await transfer.importSolveCsv(kpuzzle, previous, csv);
    expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled();
  });
});


describe("JSON v6 personal algorithm interchange", () => {
  const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", 2);
  const identity = catalogueIdentityForTarget(target.info)!;
  const preference: TrainingAlgorithmPreference = { key: trainingCatalogueKey(identity), target: identity,
    algorithm: target.info.references[0].sourceAlg, source: "catalog", note: "grip", createdAt: 1, updatedAt: 2 };
  it("semantically validates preferences, upserts by catalogue key and preserves other collections", async () => {
    const { preferenceStore } = storage();
    const archive = JSON.stringify({ version: 6, sessions: [], solves: [], trainingDrillPresets: [], trainingAttempts: [], trainingAlgorithmPreferences: [
      preference, { ...preference, key: "wrong" }, { ...preference, algorithm: "R" }, { ...preference, algorithm: "R ?" },
    ] });
    expect(await transfer.importData(kpuzzle, previous, archive)).toMatchObject({ trainingAlgorithmPreferences: 1, trainingDrillPresets: 0 });
    await transfer.importData(kpuzzle, previous, archive);
    expect(preferenceStore.size).toBe(1);
    expect(JSON.parse(await transfer.exportData())).toMatchObject({ version: 7, trainingAlgorithmPreferences: [preference], trainingDrillPresets: [], trainingAttempts: [] });
    const updated = JSON.stringify({ version: 6, sessions: [], solves: [], trainingAlgorithmPreferences: [{ ...preference, note: "updated", updatedAt: 3 }] });
    await transfer.importData(kpuzzle, previous, updated);
    expect(preferenceStore.size).toBe(1); expect(preferenceStore.get(preference.key)?.note).toBe("updated");
  });
  it.each([2, 3, 4, 5])("older v%s imports do not erase local personal algorithms", async version => {
    const { preferenceStore } = storage([], [], [], [], [preference]);
    expect(await transfer.importData(kpuzzle, previous, JSON.stringify({ version, sessions: [], solves: [] })))
      .toMatchObject({ trainingAlgorithmPreferences: 0 });
    expect(preferenceStore.get(preference.key)).toEqual(preference);
  });
});

describe("JSON v7 Recognition and run metadata", () => {
  const answer = { id: "answer", createdAt: 10, drillRunId: "run", drillRound: 2,
    target: { family: "pll" as const, trainingSet: "full" as const, caseId: "T" }, answerCaseId: "Ua", responseMs: 1200 };
  it("imports valid answers independently of Sessions, skips malformed answers, upserts IDs and exports all collections", async () => {
    const { recognitionStore } = storage();
    const archive = JSON.stringify({ version: 7, sessions: [], solves: [], trainingRecognitionAttempts: [answer,
      { ...answer, id: "bad", answerCaseId: "Sune" }, { ...answer, id: "partial", drillRunId: null }] });
    const result = await transfer.importData(kpuzzle, previous, archive);
    expect(result).toMatchObject({ trainingRecognitionAttempts: 1, trainingAttempts: 0, trainingDrillPresets: 0, trainingAlgorithmPreferences: 0 });
    await transfer.importData(kpuzzle, result.context, archive); expect(recognitionStore.size).toBe(1);
    const backup = JSON.parse(await transfer.exportData());
    expect(backup).toMatchObject({ version: 7, trainingRecognitionAttempts: [answer], trainingAttempts: [], trainingDrillPresets: [], trainingAlgorithmPreferences: [] });
  });
  it.each([2, 3, 4, 5, 6])("older v%s archives preserve existing local Recognition history", async version => {
    const { recognitionStore } = storage(); recognitionStore.set(answer.id, answer);
    expect(await transfer.importData(kpuzzle, previous, JSON.stringify({ version, sessions: [], solves: [] })))
      .toMatchObject({ trainingRecognitionAttempts: 0 });
    expect(recognitionStore.get(answer.id)).toEqual(answer);
  });
  it("defaults old presets to Execution and old Drill run metadata to null without dropping personal snapshots", async () => {
    const { presetStore, attemptStore } = storage();
    const preset = { id: "old", name: "Old", createdAt: 1, updatedAt: 1, context: { family: "pll", trainingSet: "full" }, strategy: "random", caseIds: ["T"] };
    const attempt = { id: "old-attempt", createdAt: 1, activity: "drill", mode: "virtual", caseTimeMs: 1000,
      target: { family: "pll", origin: "catalog", trainingSet: "full", caseId: "T", auf: 2 }, moves: ["R"], elapsedMs: 500, stm: 1,
      recommendedStm: 2, matchedReferenceRank: null, delta: -1, preferredStm: 1, matchedPreferred: true, preferredDelta: 0 };
    await transfer.importData(kpuzzle, previous, JSON.stringify({ version: 6, sessions: [], solves: [], trainingDrillPresets: [preset], trainingAttempts: [attempt] }));
    expect(presetStore.get("old")).toEqual({ ...preset, task: "execution" });
    expect(attemptStore.get("old-attempt")).toEqual({ ...attempt, drillRunId: null, drillRound: null });
  });
});


it("preserves independent solve-start bottom evidence through a JSON v7 round trip", async () => {
  const recorded: Solve = { ...solveFor("A"), source: "smartcube", solveStartBottomFace: "D" };
  const { solveStore } = storage(previous.sessions, [recorded]);
  const backup = await transfer.exportData();
  expect(JSON.parse(backup)).toMatchObject({ version: 7, solves: [{ solveStartBottomFace: "D" }] });
  solveStore.clear();
  await transfer.importData(kpuzzle, previous, backup);
  expect(solveStore.get(recorded.id)?.solveStartBottomFace).toBe("D");
  expect(JSON.parse(await transfer.exportData()).solves[0].solveStartBottomFace).toBe("D");
});


it("preserves a durable manual CFOP veto through JSON v7 export/import", async () => {
  const recorded: Solve = { ...solveFor("A"), source: "smartcube", cfopAnalysisExcluded: true };
  const { solveStore } = storage(previous.sessions, [recorded]);
  const backup = await transfer.exportData();
  expect(JSON.parse(backup)).toMatchObject({ version: 7, solves: [{ cfopAnalysisExcluded: true }] });
  solveStore.clear(); await transfer.importData(kpuzzle,previous,backup);
  expect(solveStore.get(recorded.id)?.cfopAnalysisExcluded).toBe(true);
});
