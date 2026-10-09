import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../../cube/puzzle";
import * as db from "../../infrastructure/persistence/db";
import { rebuildAnalysis } from "./repair";
import { Alg } from "cubing/alg";
import * as history from "./solveHistory";
import type { Session, Solve } from "../../app/types";

const kpuzzle = await get3x3x3();
const solve: Solve = {
  id: "solve-1", sessionId: "1", createdAt: 0, rawMs: 1000,
  penalty: "none", scramble: "R", source: "smartcube", moves: [{ move: "R'", t: 1000 }],
};
afterEach(() => vi.restoreAllMocks());

describe("persisted Solve history", () => {
  it.each([solve, undefined])("finds one persisted Solve without loading active or full history: %j", async record => {
    const load = vi.spyOn(db, "loadSolve").mockResolvedValue(record);
    const all = vi.spyOn(db, "loadAllSolves").mockRejectedValue(new Error("Unexpected history scan"));
    const active = vi.spyOn(db, "loadSolves").mockRejectedValue(new Error("Unexpected active history load"));
    expect(await history.findSolve(solve.id)).toBe(record);
    expect(load).toHaveBeenCalledExactlyOnceWith(solve.id);
    expect(all).not.toHaveBeenCalled();
    expect(active).not.toHaveBeenCalled();
  });

  it.each([2, 401])("persists %s repairs in bounded batches, retaining order and raw facts", async count => {
    const correction = { mode: "state-only" as const, acceptedAt: 123, analysis: rebuildAnalysis(kpuzzle, solve)!.analysis! };
    const rows = Array.from({ length: count }, (_, i) => ({ ...solve, id: `repair-${i}`, createdAt: count - i,
      penalty: "+2" as const, gripTrack: "|DF", solveStartBottomFace: "D" as const,
      cfopAnalysisExcluded: true as const, cfopAnalysisCorrection: correction }));
    const unchanged = rebuildAnalysis(kpuzzle, solve)!;
    const unrepairable = { ...solve, id: "bad", scramble: "invalid" };
    const input = [rows[0], unchanged, unrepairable, ...rows.slice(1)];
    vi.spyOn(db, "loadSolves").mockResolvedValue(input);
    const save = vi.spyOn(db, "saveSolves").mockResolvedValue();
    const individual = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const result = await history.loadSessionHistory(kpuzzle, "1");
    expect(result.map(row => row.id)).toEqual(input.map(row => row.id));
    expect(result[1]).toBe(unchanged);
    expect(result[2]).toBe(unrepairable);
    const batches = save.mock.calls.map(([batch]) => batch);
    expect(batches.map(batch => batch.length)).toEqual(count === 2 ? [2] : [200, 200, 1]);
    expect(batches.flat()).toEqual(result.filter(row => row.id.startsWith("repair-")));
    for (const row of batches.flat()) {
      const { analysis: _analysis, ...facts } = row;
      expect(facts).toEqual(rows.find(original => original.id === row.id));
      expect(row.moves).toBe(solve.moves);
      expect(row.cfopAnalysisCorrection).toBe(correction);
      expect(row.analysis).toBeTruthy();
    }
    expect(individual).not.toHaveBeenCalled();
  });

  it("waits for repaired history to be persisted before returning", async () => {
    vi.spyOn(db, "loadSolves").mockResolvedValue([solve]);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    vi.spyOn(db, "saveSolves").mockImplementation(() => { started(); return pending; });
    let returned = false;
    const loading = history.loadSessionHistory(kpuzzle, "1").then(rows => { returned = true; return rows; });
    await writing;
    expect(returned).toBe(false);
    release();
    expect((await loading)[0].analysis).toBeTruthy();
  });

  it.each(["session", "statistics"] as const)("propagates a failed repair batch from %s history", async scope => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ ...solve, id: `repair-${i}` }));
    vi.spyOn(db, "loadSolves").mockResolvedValue(rows);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue(rows);
    vi.spyOn(db, "loadSessions").mockResolvedValue([]);
    const error = new Error("Repair write failed");
    const save = vi.spyOn(db, "saveSolves").mockResolvedValueOnce().mockRejectedValueOnce(error);
    await expect(scope === "session" ? history.loadSessionHistory(kpuzzle, "1") : history.loadStatisticsSnapshot(kpuzzle)).rejects.toBe(error);
    expect(save.mock.calls.map(([batch]) => batch.length)).toEqual([200, 1]);
  });

  it("loads only the requested Session history", async () => {
    const keyboard = { ...solve, source: "keyboard" as const, moves: [] };
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([keyboard]);
    const save = vi.spyOn(db, "saveSolves").mockResolvedValue();
    expect(await history.loadSessionHistory(kpuzzle, "1")).toEqual([keyboard]);
    expect(load).toHaveBeenCalledExactlyOnceWith("1");
    expect(save).not.toHaveBeenCalled();
  });

  it.each([undefined, { cross: "legacy" }])("persists a repair of missing/normalized obsolete analysis once: %s", async (analysis) => {
    // Storage migration discards obsolete analysis before the history boundary.
    let stored = db.migrateSolve({ ...solve, analysis } as unknown as Solve);
    vi.spyOn(db, "loadSolves").mockImplementation(async () => [stored]);
    const save = vi.spyOn(db, "saveSolves").mockImplementation(async ([repaired]) => { stored = repaired; });
    const [repaired] = await history.loadSessionHistory(kpuzzle, "1");
    expect(repaired.analysis).toBeTruthy();
    expect(repaired.moves).toBe(solve.moves);
    expect(repaired.scramble).toBe(solve.scramble);
    expect(save).toHaveBeenCalledExactlyOnceWith([repaired]);
    expect(await history.loadSessionHistory(kpuzzle, "1")).toEqual([repaired]);
    expect(save).toHaveBeenCalledOnce();
  });

  it("leaves valid analysis and unrepairable records untouched", async () => {
    const valid = rebuildAnalysis(kpuzzle, solve)!;
    const unrepairable = { ...solve, id: "bad", scramble: "invalid" };
    vi.spyOn(db, "loadSolves").mockResolvedValue([valid, unrepairable]);
    const save = vi.spyOn(db, "saveSolves").mockResolvedValue();
    const result = await history.loadSessionHistory(kpuzzle, "1");
    expect(result[0]).toBe(valid);
    expect(result[1]).toBe(unrepairable);
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves loading without a puzzle before Controller initialization", async () => {
    vi.spyOn(db, "loadSolves").mockResolvedValue([solve]);
    const save = vi.spyOn(db, "saveSolves").mockResolvedValue();
    expect(await history.loadSessionHistory(undefined, "1")).toEqual([solve]);
    expect(save).not.toHaveBeenCalled();
  });

  it("loads and repairs all history for Statistics, ordered by timestamp then id", async () => {
    const sessions: Session[] = [
      { id: "1", name: "First", event: "333", createdAt: 0 },
      { id: "2", name: "Second", event: "222", createdAt: 1 },
    ];
    const other = { ...solve, id: "a", sessionId: "2", moves: [] };
    const older = { ...other, id: "z", createdAt: -1 };
    vi.spyOn(db, "loadSessions").mockResolvedValue(sessions);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([solve, other, older]);
    const activeLoad = vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const save = vi.spyOn(db, "saveSolves").mockResolvedValue();
    const snapshot = await history.loadStatisticsSnapshot(kpuzzle);
    expect(snapshot.sessions).toEqual(sessions);
    expect(snapshot.solves.map((record) => record.id)).toEqual(["z", "a", "solve-1"]);
    expect(snapshot.solves[2].analysis).toBeTruthy();
    expect(save).toHaveBeenCalledExactlyOnceWith([snapshot.solves[2]]);
    expect(activeLoad).not.toHaveBeenCalled();
    expect(solve.analysis).toBeUndefined();
  });

  it("saves a newly constructed Solve and persists updates without mutating the input", async () => {
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    await history.saveSolve(solve);
    expect(save).toHaveBeenCalledWith(solve);
    const updated = await history.updateSolve(solve, { penalty: "+2", comment: "Updated" });
    expect(updated).toEqual({ ...solve, penalty: "+2", comment: "Updated" });
    expect(save).toHaveBeenLastCalledWith(updated);
    expect(solve.penalty).toBe("none");
  });

  it("delegates deletion to the storage adapter", async () => {
    const remove = vi.spyOn(db, "deleteSolve").mockResolvedValue();
    await history.deleteSolve(solve.id);
    expect(remove).toHaveBeenCalledExactlyOnceWith(solve.id);
  });
});

it("keeps state-only preview pure, requires trust on Apply, and persists Undo independently", async () => {
  const solution = "R U R' U R U2 R'";
  const original: Solve = { ...solve, scramble: new Alg(solution).invert().toString(),
    moves: Array.from(new Alg(solution).childAlgNodes()).map((node, i) => ({ move: node.toString(), t: (i + 1) * 200 })),
    solveStartBottomFace: "L", gripTrack: "|LF", cfopAnalysisExcluded: true };
  const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
  expect(history.previewCfopCorrection(kpuzzle, original)?.analysis.quality?.status).toBe("trusted");
  expect(save).not.toHaveBeenCalled();
  const accepted = await history.applyCfopCorrection(kpuzzle, original);
  expect(accepted?.cfopAnalysisCorrection).toBeDefined();
  expect(accepted?.cfopAnalysisExcluded).toBe(true);
  expect(await history.clearCfopCorrection(accepted!)).toEqual(original);
  save.mockClear();
  const ambiguous = { ...solve, scramble: "F2 R2 F2 R2", moves: ["R2", "F2", "R2", "F2"].map((move, i) => ({ move, t: (i + 1) * 200 })) };
  expect(history.previewCfopCorrection(kpuzzle, ambiguous)?.analysis.quality?.status).toBe("suspect");
  expect(await history.applyCfopCorrection(kpuzzle, ambiguous)).toBeNull();
  expect(await history.applyCfopCorrection(undefined, original)).toBeNull();
  expect(save).not.toHaveBeenCalled();
});


it("persists a reversible CFOP veto across history reload without changing solve timing", async () => {
  let stored = rebuildAnalysis(kpuzzle, solve)!;
  vi.spyOn(db, "saveSolve").mockImplementation(async record => { stored = record; });
  vi.spyOn(db, "loadSolves").mockImplementation(async () => [stored]);
  await history.updateSolve(stored, { cfopAnalysisExcluded: true });
  const [reloaded] = await history.loadSessionHistory(kpuzzle, "1");
  expect(reloaded.cfopAnalysisExcluded).toBe(true);
  expect(reloaded.rawMs).toBe(solve.rawMs);
  expect(reloaded.penalty).toBe("none");
  await history.updateSolve(reloaded, { cfopAnalysisExcluded: undefined });
  expect((await history.loadSessionHistory(kpuzzle, "1"))[0].cfopAnalysisExcluded).toBeUndefined();
});
