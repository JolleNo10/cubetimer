import type { WhiteCrossMoves } from "../cube/crossScramble";
import type { XCrossMaxMoves } from "./types";

type PracticeScrambleDetails = {
  label: string;
  title: string;
};

export function whiteCrossProvider(moves: WhiteCrossMoves): string {
  return `cubetimer:white-cross-exact:${moves}`;
}

export function xCrossProvider(maxMoves: XCrossMaxMoves): string {
  return `cubetimer:xcross-max:${maxMoves}`;
}

function practiceScrambleDetails(provider?: string): PracticeScrambleDetails | null {
  const whiteCross = /^cubetimer:white-cross-exact:([1-7])$/.exec(provider ?? "");
  if (whiteCross) {
    const moves = Number(whiteCross[1]);
    return {
      label: `cross ${moves}`,
      title: `Exact ${moves}-move white-cross scramble`,
    };
  }

  const xCross = /^cubetimer:xcross-max:([4-6])$/.exec(provider ?? "");
  if (xCross) {
    const maxMoves = Number(xCross[1]);
    return {
      label: `xcross ≤${maxMoves}`,
      title: `Generated XCross scramble with a ${maxMoves}-move maximum`,
    };
  }

  return null;
}

export function practiceScrambleLabel(provider?: string): string | null {
  return practiceScrambleDetails(provider)?.label ?? null;
}

export function practiceScrambleTitle(provider?: string): string | null {
  return practiceScrambleDetails(provider)?.title ?? null;
}
