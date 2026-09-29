/**
 * Gestures made on the cube itself, for things you would otherwise reach for the
 * keyboard to do. The point is that your hands never leave the cube.
 */
import { parseMove } from "./notation";

/** Turns of the same face, in the same direction, that make up the recentre gesture. */
export const RECENTRE_GESTURE_TURNS = 3;

/** Four turns of the down face, used to repeat a completed F2L setup. */
export const F2L_AGAIN_GESTURE_TURNS = 4;

function isRepeatedQuarterTurnGesture(
  moves: readonly string[],
  face: string,
  count: number,
): boolean {
  if (moves.length < count) return false;
  const turns = moves.slice(-count).map(parseMove);
  const first = turns[0];
  if (!first || first.family !== face || Math.abs(first.amount) !== 1) return false;
  return turns.every(
    (turn) => turn?.family === face && turn.amount === first.amount,
  );
}

/**
 * Three turns of the top face in the same direction: hold the cube the way you want
 * the screen to show it and turn `U` three times.
 *
 * A scramble can never ask for this — generated scrambles never turn the same face
 * twice in a row, let alone three times — so it cannot be made by accident while
 * setting a scramble up.
 */
export function isRecentreGesture(moves: readonly string[]): boolean {
  return isRepeatedQuarterTurnGesture(moves, "U", RECENTRE_GESTURE_TURNS);
}

export function isF2lAgainGesture(moves: readonly string[]): boolean {
  return isRepeatedQuarterTurnGesture(moves, "D", F2L_AGAIN_GESTURE_TURNS);
}
