/**
 * Finding better ways to have done what you did.
 *
 * For each step of a solve we know the state it started from and the state it ended
 * at. The shortest sequence between those two is the fewest moves that would have
 * achieved the same thing — so comparing it with what was actually turned says how
 * much of a step was wasted motion rather than progress.
 *
 * The search is exhaustive within its depth limit, so "no shorter way" is a real
 * answer and not a failure to look hard enough.
 */
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { experimentalSolveTwips } from "cubing/search";
import { countTurns } from "./notation";

/** Only outer face turns: nobody wants a "better" solution written in slice moves. */
const FACE_TURNS = ["U", "R", "F", "D", "L", "B"];

/**
 * How deep to look.
 *
 * The search has pruning tables that settle anything up to ten moves in well under a
 * tenth of a second; at eleven they stop helping and the same question takes twenty
 * seconds. Steps longer than that are reported as unsearched rather than made to wait.
 */
export const MAX_SEARCH_DEPTH = 10;

export type Improvement = {
  /** Moves the solver actually used. */
  used: number;
  /** The shortest sequence achieving the same, if a shorter one exists. */
  best: string | null;
  /** Length of `best`, or `used` when nothing shorter was found. */
  bestLength: number;
  /** True when the search covered every shorter possibility and found none. */
  optimal: boolean;
  /** True when the step was too long to search exhaustively. */
  tooDeep: boolean;
};

/**
 * Look for a shorter way from `from` to `to`.
 *
 * Only sequences strictly shorter than `used` are of interest, which both bounds the
 * work and makes the answer meaningful: finding nothing means what was done could not
 * be beaten.
 */
export async function findShorter(
  kpuzzle: KPuzzle,
  from: KPattern,
  to: KPattern,
  used: number,
): Promise<Improvement> {
  const unchanged: Improvement = {
    used,
    best: null,
    bestLength: used,
    optimal: false,
    tooDeep: false,
  };
  if (used <= 1) return { ...unchanged, optimal: used === 0 };
  if (used - 1 > MAX_SEARCH_DEPTH) return { ...unchanged, tooDeep: true };

  // Asking the search to hit a target pattern costs it its pruning tables and turns a
  // deep search into minutes. Solving the difference between the two states down to a
  // solved cube is the same question with the tables back, and is far quicker.
  const difference = differenceBetween(kpuzzle, from, to);
  if (!difference) return unchanged;

  try {
    const undo = await experimentalSolveTwips(kpuzzle, difference, {
      generatorMoves: FACE_TURNS,
      minDepth: 0,
      maxDepth: used - 1,
    });
    // Undoing the difference is the reverse of applying it.
    const solution = undo.invert();
    const length = countTurns(
      Array.from(solution.childAlgNodes()).map((node) => node.toString()),
    ).sliceTurns;
    return {
      used,
      best: solution.toString(),
      bestLength: length,
      optimal: false,
      tooDeep: false,
    };
  } catch {
    // The search space was exhausted without finding anything shorter.
    return { ...unchanged, optimal: true };
  }
}

/**
 * The state that stands for "what has to change to get from one state to the other",
 * which is solved exactly when the two states are the same.
 */
function differenceBetween(
  kpuzzle: KPuzzle,
  from: KPattern,
  to: KPattern,
): KPattern | null {
  const a = from.experimentalToTransformation();
  const b = to.experimentalToTransformation();
  if (!a || !b) return null;
  return kpuzzle
    .defaultPattern()
    .applyTransformation(a.invert().applyTransformation(b));
}

/** The whole solve in as few moves as the solver can manage, as a yardstick. */
export async function shortestWholeSolve(
  scrambled: KPattern,
): Promise<{ alg: string; length: number } | null> {
  try {
    const { experimentalSolve3x3x3IgnoringCenters } = await import("cubing/search");
    const solution = await experimentalSolve3x3x3IgnoringCenters(scrambled);
    const moves = Array.from(solution.childAlgNodes()).map((n) => n.toString());
    return { alg: new Alg(moves.join(" ")).toString(), length: countTurns(moves).sliceTurns };
  } catch {
    return null;
  }
}
