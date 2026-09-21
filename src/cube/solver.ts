import { Alg, Move } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";

/**
 * Rewrite an alg in the notation cubers actually read: `U`, `U'` or `U2`.
 *
 * Simplification can leave moves written as `D3'` or `B2'`, which are correct but
 * awkward to follow off a screen while holding a cube.
 */
export function normalizeFaceTurns(alg: Alg): Alg {
  const moves: Move[] = [];
  for (const node of alg.expand().childAlgNodes()) {
    const move = node.as(Move);
    if (!move) continue;
    const amount = ((move.amount % 4) + 4) % 4;
    if (amount === 0) continue;
    moves.push(new Move(move.family, amount === 3 ? -1 : amount));
  }
  return new Alg(moves);
}

/**
 * Find a short sequence that takes `from` to `to`.
 *
 * Used when the cube is not in the state the app expects — typically the user turned a
 * wrong face while scrambling — so we can show a way back instead of refusing to go on.
 * The search runs on the difference between the two states, so undoing one wrong move
 * costs one move rather than a full solve and re-scramble.
 */
export async function algBetween(from: KPattern, to: KPattern): Promise<Alg> {
  const fromTransformation = from.experimentalToTransformation();
  const toTransformation = to.experimentalToTransformation();
  if (fromTransformation && toTransformation) {
    const difference = fromTransformation.invert().applyTransformation(toTransformation);
    const pattern = from.kpuzzle.defaultPattern().applyTransformation(difference);
    return normalizeFaceTurns(
      (await experimentalSolve3x3x3IgnoringCenters(pattern)).invert(),
    );
  }
  // Centre orientation can make a pattern unrepresentable as a transformation; fall
  // back to solving the cube and scrambling it again.
  const toSolved = await experimentalSolve3x3x3IgnoringCenters(from);
  const fromSolved = (await experimentalSolve3x3x3IgnoringCenters(to)).invert();
  return normalizeFaceTurns(
    toSolved.concat(fromSolved).experimentalSimplify({ cancel: true }),
  );
}

/** Find a sequence that solves `pattern`. */
export async function solveAlg(pattern: KPattern): Promise<Alg> {
  return normalizeFaceTurns(await experimentalSolve3x3x3IgnoringCenters(pattern));
}
