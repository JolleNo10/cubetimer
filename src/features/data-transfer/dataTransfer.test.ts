import { buildLastLayerCatalogueTarget } from "../../cube/lastLayerTraining";
import { catalogueIdentityForTarget, trainingCatalogueKey } from "../../app/trainingCatalogue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../../cube/puzzle";
import { DEFAULT_EVENT_ID } from "../../cube/scramble";
import * as db from "../../infrastructure/persistence/db";
import * as transfer from "./dataTransfer";
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
  vi.spyOn(db, "loadSolves").mockImplementation(async (id) => [...solveStore.values()].filter((value) => value.sessionId === id));
  vi.spyOn(db, "saveSession").mockImplementation(async (value) => { sessionStore.set(value.id, value); });
  vi.spyOn(db, "saveSolve").mockImplementation(async (value) => { solveStore.set(value.id, value); });
  return { sessionStore, solveStore, attemptStore, presetStore, preferenceStore };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("JSON backup workflow", () => {
  it("imports v3 history as Single/null and exports current Drill fields in v6, keeping stable IDs", async () => {
    const old = { id: "old-training", createdAt: 10, mode: "virtual",
      target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 4", position: "FR" },
      moves: ["R"], stm: 1, elapsedMs: 0, recommendedStm: 1, matchedReferenceRank: 1, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: 0 };
    const { attemptStore } = storage();
    const v3 = JSON.stringify({ version: 3, sessions: [], solves: [], trainingAttempts: [old] });
    await transfer.importData(kpuzzle, previous, v3);
    expect(attemptStore.get(old.id)).toEqual({ ...old, activity: "single", caseTimeMs: null });
    const drill = { ...old, id: "drill", activity: "drill", caseTimeMs: 2100 };
    const v4 = JSON.stringify({ version: 4, sessions: [], solves: [], trainingAttempts: [drill] });
    await transfer.importData(kpuzzle, previous, v4); await transfer.importData(kpuzzle, previous, v4);
    expect(attemptStore.size).toBe(2);
    expect(JSON.parse(await transfer.exportData())).toMatchObject({ version: 6, trainingAttempts: [
      { ...old, activity: "single", caseTimeMs: null }, drill,
    ] });
  });
  it("exports version 6 with solve, Training and preset records", async () => {
    const sessions = [session("A", "222")];
    const solves = [solveFor("A")];
    storage(sessions, solves);
    vi.spyOn(Date, "now").mockReturnValue(1234);
    expect(JSON.parse(await transfer.exportData())).toEqual({
      format: "cubetimer", version: 6, exportedAt: 1234, sessions, solves, trainingAttempts: [], trainingDrillPresets: [], trainingAlgorithmPreferences: [],
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
      sessions: 1, solves: 1, trainingAttempts: 0, trainingDrillPresets: 0, trainingAlgorithmPreferences: 0,
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
  });

  it("rejects conflicting incoming definitions before writing", async () => {
    storage([]);
    await expect(transfer.importData(kpuzzle, previous, jsonExport([session("B"), session("B", "222")]))).rejects.toThrow(/conflicting events/);
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled();
  });

  it("returns the selected imported event transition and retains selection over newer Sessions", async () => {
    storage();
    const result = await transfer.importData(kpuzzle, previous, jsonExport([session("A", "222"), session("B")]));
    expect(result.context.sessionId).toBe("A");
    expect(result.context.eventChanged).toBe(true);
    expect(result.context.solves).toEqual([]);
  });

  it("imports current Training facts, skips malformed records and upserts IDs even without their source Solve", async () => {
    const attempt: TrainingAttempt = { id: "attempt", createdAt: 10, mode: "virtual", activity: "single", caseTimeMs: null,
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
    const attempt: TrainingAttempt = { id: "global", createdAt: 0, mode: "setup", activity: "single", caseTimeMs: null,
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
  });
});

describe("solve-analysis CSV workflow", () => {
  const imported = { ...session("import:Imported"), name: "Imported" };
  const csvFor = (solves = [solveFor(imported.id)]) =>
    formatSolveCsv(solves, new Map([[imported.id, imported.name]]));

  it("keeps compatible repeat imports idempotent and returns Session/Solve counts", async () => {
    const { sessionStore, solveStore } = storage();
    const progress = vi.fn();
    const result = await transfer.importSolveCsv(kpuzzle, previous, csvFor(), progress);
    expect(result).toMatchObject({ sessions: 1, solves: 1, context: { sessionId: "A", eventChanged: false } });
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
    expect(db.saveSolve).not.toHaveBeenCalled();
  });

  it("validates later batches before writing any earlier batch", async () => {
    storage([{ ...imported, event: "222" }]);
    const rows = Array.from({ length: 200 }, (_, i) => solveFor("other", `other-${i}`));
    rows.push(solveFor(imported.id));
    const csv = formatSolveCsv(rows, new Map([["other", "Other"], [imported.id, imported.name]]));
    await expect(transfer.importSolveCsv(kpuzzle, previous, csv)).rejects.toThrow(/Cannot merge session/);
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveSolve).not.toHaveBeenCalled();
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

describe("JSON v5 saved drills", () => {
  const preset: TrainingDrillPreset = { id: "preset", name: "Same name", createdAt: 10, updatedAt: 20,
    context: { family: "oll", trainingSet: "2look" }, caseIds: ["L-Shape"], strategy: "weighted" };
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
    expect(exported).toMatchObject({ version: 6, sessions: previous.sessions, solves: [], trainingAttempts: [] });
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
    storage(previous.sessions, [solveFor("A")], [], [preset]);
    const csv = await transfer.exportSolveCsv("all", previous.sessions, []);
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
    expect(JSON.parse(await transfer.exportData())).toMatchObject({ version: 6, trainingAlgorithmPreferences: [preference], trainingDrillPresets: [], trainingAttempts: [] });
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
