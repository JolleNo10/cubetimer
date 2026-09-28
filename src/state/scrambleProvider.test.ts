import { describe, expect, it } from "vitest";
import {
  practiceScrambleLabel,
  practiceScrambleTitle,
  whiteCrossProvider,
  xCrossProvider,
} from "./scrambleProvider";

describe("special scramble providers", () => {
  it("encodes every exact white-cross length with its matching label", () => {
    for (const moves of [1, 2, 3, 4, 5, 6, 7] as const) {
      const provider = whiteCrossProvider(moves);
      expect(provider).toBe(`cubetimer:white-cross-exact:${moves}`);
      expect(practiceScrambleLabel(provider)).toBe(`cross ${moves}`);
      expect(practiceScrambleTitle(provider)).toBe(
        `Exact ${moves}-move white-cross scramble`,
      );
    }
  });

  it("encodes XCross maximum lengths with the less-than-or-equal label", () => {
    for (const maxMoves of [4, 5, 6] as const) {
      const provider = xCrossProvider(maxMoves);
      expect(provider).toBe(`cubetimer:xcross-max:${maxMoves}`);
      expect(practiceScrambleLabel(provider)).toBe(`xcross ≤${maxMoves}`);
      expect(practiceScrambleTitle(provider)).toBe(
        `Generated XCross scramble with a ${maxMoves}-move maximum`,
      );
    }
  });

  it("does not label normal or unknown providers", () => {
    expect(practiceScrambleLabel()).toBeNull();
    expect(practiceScrambleTitle()).toBeNull();
    expect(practiceScrambleLabel("random_state")).toBeNull();
    expect(practiceScrambleTitle("random_state")).toBeNull();
    expect(practiceScrambleLabel("cubetimer:white-cross-exact:8")).toBeNull();
    expect(practiceScrambleLabel("cubetimer:xcross-max:7")).toBeNull();
    expect(practiceScrambleLabel("cubetimer:white-cross-exact:5:other")).toBeNull();
  });
});
