import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_ID } from "../cube/scramble";
import { mergeSettings, migrateSession, migrateSolve } from "./db";
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
  it("drops the legacy event while preserving canonical solve facts", () => {
    const migrated = migrateSolve(base);
    expect(migrated).not.toHaveProperty("event");
    expect(migrated.moves).toEqual(base.moves);
  });

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
  it("discards a legacy active event", () => {
    const settings = mergeSettings({ event: "222" } as never);
    expect(settings).not.toHaveProperty("event");
  });

  it("uses the default white-cross length for older settings", () => {
    expect(mergeSettings({}).whiteCrossMoves).toBe(5);
  });

  it("rejects persisted white-cross lengths outside 1 through 7", () => {
    expect(mergeSettings({ whiteCrossMoves: 0 as never }).whiteCrossMoves).toBe(5);
    expect(mergeSettings({ whiteCrossMoves: 8 as never }).whiteCrossMoves).toBe(5);
  });
});

describe("migrateSession", () => {
  it("normalizes missing or invalid events to the canonical default", () => {
    expect(migrateSession({ id: "s", name: "Session 1", createdAt: 0 })).toMatchObject({
      event: DEFAULT_EVENT_ID,
    });
    expect(
      migrateSession({ id: "s", name: "Session 1", createdAt: 0, event: "not-an-event" }),
    ).toMatchObject({ event: DEFAULT_EVENT_ID });
  });

  it("keeps the persisted Session event when legacy solve data conflicts", () => {
    const session = migrateSession({
      id: "s",
      name: "Session 1",
      createdAt: 0,
      event: "222",
    });
    const solve = migrateSolve({ ...base, event: "333" });
    expect(session.event).toBe("222");
    expect(solve).not.toHaveProperty("event");
  });
});
