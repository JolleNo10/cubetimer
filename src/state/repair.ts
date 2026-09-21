import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { analyseSolve } from "../cube/analysis";
import { faceletsToPattern } from "../cube/facelets";
import type { Solve } from "./types";

/**
 * The state a solve began from.
 *
 * Solves recorded here store the exact scrambled state, which is the truthful answer.
 * Imported ones only have the scramble sequence, which comes to the same thing for a
 * scramble that was actually applied.
 */
function startingPattern(kpuzzle: KPuzzle, solve: Solve): KPattern | null {
  if (solve.scrambledFacelets) {
    try {
      return faceletsToPattern(kpuzzle, solve.scrambledFacelets);
    } catch {
      // Fall through to the scramble.
    }
  }
  if (!solve.scramble) return null;
  try {
    return kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble));
  } catch {
    return null;
  }
}

/**
 * Rebuild a solve's analysis from the moves it recorded.
 *
 * An analysis is derived data: the scramble and the move stream are the facts, and the
 * breakdown is what this app makes of them. So an analysis that is missing — because it
 * was stored under an older model and could not be read — is recomputed rather than
 * lost. Returns `null` when there is nothing to do.
 */
export function rebuildAnalysis(kpuzzle: KPuzzle, solve: Solve): Solve | null {
  if (solve.analysis || solve.moves.length === 0) return null;
  const from = startingPattern(kpuzzle, solve);
  if (!from) return null;
  const analysis = analyseSolve(from, solve.moves);
  if (!analysis) return null;
  return { ...solve, analysis };
}
