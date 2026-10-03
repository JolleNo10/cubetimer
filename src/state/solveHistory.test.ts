import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../cube/puzzle";
import * as db from "./db";
import { rebuildAnalysis } from "./repair";
import * as history from "./solveHistory";
import type { Session, Solve } from "./types";

const kpuzzle = await get3x3x3();
const solve: Solve = {
  id: "solve-1", sessionId: "1", createdAt: 0, rawMs: 1000,
  penalty: "none", scramble: "R", source: "smartcube", moves: [{ move: "R'", t: 1000 }],
};
afterEach(() => vi.restoreAllMocks());

describe("persisted Solve history", () => {
  it("loads only the requested Session history", async () => {
    const keyboard = { ...solve, source: "keyboard" as const, moves: [] };
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([keyboard]);
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    expect(await history.loadSessionHistory(kpuzzle, "1")).toEqual([keyboard]);
    expect(load).toHaveBeenCalledExactlyOnceWith("1");
    expect(save).not.toHaveBeenCalled();
  });

  it.each([undefined, { cross: "legacy" }])("persists a repair of missing/normalized obsolete analysis once: %s", async (analysis) => {
    // Storage migration discards obsolete analysis before the history boundary.
    let stored = db.migrateSolve({ ...solve, analysis } as unknown as Solve);
    vi.spyOn(db, "loadSolves").mockImplementation(async () => [stored]);
    const save = vi.spyOn(db, "saveSolve").mockImplementation(async (repaired) => { stored = repaired; });
    const [repaired] = await history.loadSessionHistory(kpuzzle, "1");
    expect(repaired.analysis).toBeTruthy();
    expect(repaired.moves).toBe(solve.moves);
    expect(repaired.scramble).toBe(solve.scramble);
    expect(save).toHaveBeenCalledExactlyOnceWith(repaired);
    expect(await history.loadSessionHistory(kpuzzle, "1")).toEqual([repaired]);
    expect(save).toHaveBeenCalledOnce();
  });

  it("leaves valid analysis and unrepairable records untouched", async () => {
    const valid = rebuildAnalysis(kpuzzle, solve)!;
    const unrepairable = { ...solve, id: "bad", scramble: "invalid" };
    vi.spyOn(db, "loadSolves").mockResolvedValue([valid, unrepairable]);
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const result = await history.loadSessionHistory(kpuzzle, "1");
    expect(result[0]).toBe(valid);
    expect(result[1]).toBe(unrepairable);
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves loading without a puzzle before Controller initialization", async () => {
    vi.spyOn(db, "loadSolves").mockResolvedValue([solve]);
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
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
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const snapshot = await history.loadStatisticsSnapshot(kpuzzle);
    expect(snapshot.sessions).toEqual(sessions);
    expect(snapshot.solves.map((record) => record.id)).toEqual(["z", "a", "solve-1"]);
    expect(snapshot.solves[2].analysis).toBeTruthy();
    expect(save).toHaveBeenCalledExactlyOnceWith(snapshot.solves[2]);
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
