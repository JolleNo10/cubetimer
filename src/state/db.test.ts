import { describe, expect, it } from "vitest";
import { mergeSettings, migrateSolve } from "./db";
import type { Solve } from "./types";

const base = {
  id: "1",
  sessionId: "s",
  createdAt: 0,
  rawMs: 1000,
  penalty: "none",
  scramble: "R U",
  event: "333",
  source: "smartcube",
  moves: [{ move: "R", t: 10 }],
} as unknown as Solve;

describe("migrateSolve", () => {
  it("drops an analysis written before the solve model had steps", () => {
    const legacy = {
      ...base,
      // The old shape: phases, with none of the per-step detail the UI now reads.
      analysis: { crossFace: "D", phases: [{ name: "Cross", durationMs: 500 }] },
    } as unknown as Solve;
    expect(migrateSolve(legacy).analysis).toBeNull();
  });

  it("leaves a current analysis alone", () => {
    const current = { ...base, analysis: { steps: [{ name: "Cross" }] } } as unknown as Solve;
    expect(migrateSolve(current).analysis).toEqual({ steps: [{ name: "Cross" }] });
  });

  it("leaves solves with no analysis alone", () => {
    expect(migrateSolve(base).analysis).toBeUndefined();
    expect(migrateSolve({ ...base, analysis: null }).analysis).toBeNull();
  });

  it("gives a solve with no move stream an empty one", () => {
    const noMoves = { ...base, moves: undefined } as unknown as Solve;
    expect(migrateSolve(noMoves).moves).toEqual([]);
  });
});

describe("mergeSettings", () => {
  it("uses the default white-cross length for older settings", () => {
    expect(mergeSettings({}).whiteCrossMoves).toBe(5);
  });

  it("rejects persisted white-cross lengths outside 1 through 7", () => {
    expect(mergeSettings({ whiteCrossMoves: 0 as never }).whiteCrossMoves).toBe(5);
    expect(mergeSettings({ whiteCrossMoves: 8 as never }).whiteCrossMoves).toBe(5);
  });
});
