import { describe, expect, it } from "vitest";
import {
  countTurns,
  formatTimedMoves,
  mergeSameFaceTurns,
  parseMove,
  parseTimedMoves,
} from "./notation";

describe("parseMove", () => {
  it("reads every form that appears in solve data", () => {
    expect(parseMove("R")).toEqual({ family: "R", amount: 1 });
    expect(parseMove("R'")).toEqual({ family: "R", amount: -1 });
    expect(parseMove("U2")).toEqual({ family: "U", amount: 2 });
    expect(parseMove("U2'")).toEqual({ family: "U", amount: -2 });
    // Amounts are not reduced: four anticlockwise U turns really happened.
    expect(parseMove("U4'")).toEqual({ family: "U", amount: -4 });
    expect(parseMove("M")).toEqual({ family: "M", amount: 1 });
    expect(parseMove("z2")).toEqual({ family: "z", amount: 2 });
  });

  it("rejects anything else", () => {
    expect(parseMove("Rw")).toBeNull();
    expect(parseMove("")).toBeNull();
  });
});

describe("countTurns", () => {
  // Checked against the figures a real export gives for these exact steps.
  it("counts a plain face-turn step", () => {
    // "z2 R L D B' R B2' R' F R" → 9 STM, 9 ETM, 10 QTM
    expect(countTurns("z2 R L D B' R B2' R' F R".split(" "))).toEqual({
      sliceTurns: 9,
      faceTurns: 9,
      quarterTurns: 10,
    });
  });

  it("counts a slice as one turn but two faces", () => {
    // "U2' S' L U L' U' L' B L F' z" → 10 STM, 11 ETM, 12 QTM
    expect(countTurns("U2' S' L U L' U' L' B L F' z".split(" "))).toEqual({
      sliceTurns: 10,
      faceTurns: 11,
      quarterTurns: 12,
    });
  });

  it("ignores rotations entirely", () => {
    expect(countTurns(["x", "y", "z2"])).toEqual({
      sliceTurns: 0,
      faceTurns: 0,
      quarterTurns: 0,
    });
  });
});

describe("timed moves", () => {
  it("round-trips the recorded format", () => {
    const text = "L[0] R[287] U'[1191] B2'[1944]";
    const moves = parseTimedMoves(text);
    expect(moves).toHaveLength(4);
    expect(moves[2]).toEqual({ move: "U'", t: 1191 });
    expect(formatTimedMoves(moves)).toBe(text);
  });
});

describe("mergeSameFaceTurns", () => {
  it("collapses a run and keeps the last timestamp", () => {
    // Two D' quarter turns are one D2' that finished at 7128.
    expect(
      mergeSameFaceTurns([
        { move: "D'", t: 6988 },
        { move: "D'", t: 7128 },
        { move: "L", t: 7660 },
      ]),
    ).toEqual([
      { move: "D2'", t: 7128 },
      { move: "L", t: 7660 },
    ]);
  });

  it("keeps a turn and its correction apart", () => {
    // U then U' is someone fixing a mistake, not a half turn.
    const moves = [
      { move: "U", t: 10 },
      { move: "U'", t: 20 },
      { move: "R", t: 30 },
    ];
    expect(mergeSameFaceTurns(moves)).toEqual(moves);
  });

  it("does not merge across a pause", () => {
    // Three D turns, but the solver stopped to think after the first.
    expect(
      mergeSameFaceTurns([
        { move: "D", t: 11224 },
        { move: "D", t: 12766 },
        { move: "D", t: 13393 },
      ]),
    ).toEqual([
      { move: "D", t: 11224 },
      { move: "D2", t: 13393 },
    ]);
  });

  it("leaves distinct faces alone", () => {
    const moves = [
      { move: "R", t: 1 },
      { move: "U", t: 2 },
      { move: "R", t: 3 },
    ];
    expect(mergeSameFaceTurns(moves)).toEqual(moves);
  });
});
