/**
 * Gestures made on the cube itself, for things you would otherwise reach for the
 * keyboard to do. The point is that your hands never leave the cube.
 */
import { parseMove } from "./notation";

/** Turns of the same face, in the same direction, that make up the recentre gesture. */
export const RECENTRE_GESTURE_TURNS = 3;

/**
 * Three turns of the top face in the same direction: hold the cube the way you want
 * the screen to show it and turn `U` three times.
 *
 * A scramble can never ask for this — generated scrambles never turn the same face
 * twice in a row, let alone three times — so it cannot be made by accident while
 * setting a scramble up.
 */
export function isRecentreGesture(moves: readonly string[]): boolean {
  if (moves.length < RECENTRE_GESTURE_TURNS) return false;
  const turns = moves.slice(-RECENTRE_GESTURE_TURNS).map(parseMove);
  const first = turns[0];
  if (!first || first.family !== "U" || Math.abs(first.amount) !== 1) return false;
  return turns.every(
    (turn) => turn?.family === "U" && turn.amount === first.amount,
  );
}
