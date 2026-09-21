import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { ScrambleTracker } from "./scramble";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

function after(moves: string) {
  return kpuzzle.defaultPattern().applyAlg(new Alg(moves));
}

describe("ScrambleTracker", () => {
  const scramble = "R2 U' F D2 L";
  const tracker = () => new ScrambleTracker(kpuzzle, scramble);

  it("starts at zero on a solved cube", () => {
    const progress = tracker().update(kpuzzle.defaultPattern());
    expect(progress).toMatchObject({
      index: 0,
      total: 5,
      onTrack: true,
      done: false,
      nextMove: "R2",
      partial: false,
    });
  });

  it("counts a half turn only once both quarter turns are made", () => {
    const t = tracker();
    expect(t.update(after("R"))).toMatchObject({
      index: 0,
      onTrack: true,
      partial: true,
      nextMove: "R2",
    });
    expect(t.update(after("R2"))).toMatchObject({
      index: 1,
      onTrack: true,
      partial: false,
      nextMove: "U'",
    });
  });

  it("follows the scramble to the end", () => {
    const t = tracker();
    expect(t.update(after("R2 U' F")).index).toBe(3);
    const done = t.update(after(scramble));
    expect(done).toMatchObject({ index: 5, done: true, nextMove: null });
  });

  it("goes backwards when a move is undone", () => {
    const t = tracker();
    t.update(after("R2 U' F"));
    expect(t.update(after("R2 U'"))).toMatchObject({ index: 2, onTrack: true });
  });

  it("reports being off track after a wrong move", () => {
    const t = tracker();
    t.update(after("R2 U'"));
    const off = t.update(after("R2 U' B"));
    expect(off.onTrack).toBe(false);
    expect(off.index).toBe(2); // holds the last known position
  });
});
