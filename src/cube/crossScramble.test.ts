import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import {
  buildWhiteCrossTarget,
  generateWhiteCrossScramble,
  type WhiteCrossMoves,
  whiteCrossDistance,
} from "./crossScramble";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();
const seed = kpuzzle.defaultPattern().applyAlg(
  new Alg("R U2 F' L D2 B R' U F2 D' L2 B2 U' R2 F D L' B"),
);
const deterministicRandom = () => 0.5;

describe("white cross scramble construction", () => {
  it.each([1, 2, 3, 4, 5, 6, 7] as WhiteCrossMoves[])(
    "constructs an exact %i-move white cross",
    (requestedMoves) => {
      const target = buildWhiteCrossTarget(
        kpuzzle,
        seed,
        requestedMoves,
        deterministicRandom,
      );

      expect(whiteCrossDistance(kpuzzle, target)).toBe(requestedMoves);
    },
  );

  it("rejects distances outside the supported range", () => {
    expect(() =>
      buildWhiteCrossTarget(kpuzzle, seed, 0 as WhiteCrossMoves, deterministicRandom),
    ).toThrow("White cross moves must be between 1 and 7");
    expect(() =>
      buildWhiteCrossTarget(kpuzzle, seed, 8 as WhiteCrossMoves, deterministicRandom),
    ).toThrow("White cross moves must be between 1 and 7");
    expect(() =>
      buildWhiteCrossTarget(kpuzzle, seed, Number.NaN as WhiteCrossMoves, deterministicRandom),
    ).toThrow("White cross moves must be between 1 and 7");
  });

  it("returns a normal scramble that preserves the exact distance", async () => {
    const scramble = await generateWhiteCrossScramble(
      "333",
      4,
      deterministicRandom,
    );
    const target = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));

    expect(whiteCrossDistance(kpuzzle, target)).toBe(4);
  });
});
