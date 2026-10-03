/**
 * Frame conversions shared by runtime, analysis and presentation.
 * Move conversion changes notation; display rotation moves the viewed pattern.
 * Case reframing relabels both pieces and slots and remains a distinct operation.
 */
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { faceletsToPattern, patternToFacelets } from "./facelets";
import type { TimedMove } from "./notation";
import { IDENTITY, invert, reorientMove, rotationTokensBetween, type Orientation } from "./orientation";

export { reframe, withCentresHome } from "./recognise";

/** One physical cube-frame move, expressed in the held/training frame. */
export function handMove(move: string, grip: Orientation): string {
  if (/\s/.test(move)) throw new Error("Expected one move; use handAlgorithm for an algorithm.");
  return reorientMove(move, grip);
}

/** One held/training-frame move, expressed in the physical cube frame. */
export function cubeMove(move: string, grip: Orientation): string {
  if (/\s/.test(move)) throw new Error("Expected one move; use cubeAlgorithm for an algorithm.");
  return reorientMove(move, invert(grip));
}

export function expandedAlgorithmMoves(algorithm: string): string[] {
  return Array.from(new Alg(algorithm).expand().childAlgNodes()).map((node) => node.toString());
}

/** Convert every expanded move of a physical-frame algorithm to the held frame. */
export function handAlgorithm(algorithm: string, grip: Orientation): string {
  return expandedAlgorithmMoves(algorithm).map((move) => handMove(move, grip)).join(" ");
}

/** Convert every expanded move of a held-frame algorithm to the physical frame. */
export function cubeAlgorithm(algorithm: string, grip: Orientation): string {
  return expandedAlgorithmMoves(algorithm).map((move) => cubeMove(move, grip)).join(" ");
}

export function handMoves(moves: readonly string[], grip: Orientation): string[] {
  return moves.map((move) => handMove(move, grip));
}

export function cubeMoves(moves: readonly string[], grip: Orientation): string[] {
  return moves.map((move) => cubeMove(move, grip));
}

export function handTimedMoves(moves: readonly TimedMove[], grip: Orientation): TimedMove[] {
  return moves.map(({ move, t }) => ({ move: handMove(move, grip), t }));
}

/** Physically rotate a viewed pattern; this does not relabel a case for recognition. */
export function orientFaceletsForDisplay(kpuzzle: KPuzzle, facelets: string, orientation: Orientation): string {
  const tokens = rotationTokensBetween(IDENTITY, orientation);
  return patternToFacelets(faceletsToPattern(kpuzzle, facelets).applyAlg(new Alg(tokens.join(" "))));
}
