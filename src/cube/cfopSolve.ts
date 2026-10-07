/**
 * A plain CFOP solution for a scramble: cross, four pairs, OLL, PLL.
 *
 * Not a good solution — the shortest cross, then whichever pair has the shortest
 * catalogue algorithm, then the shortest catalogue last-layer algorithms — but one that
 * goes through CFOP's phases the way a solver does, which a computer solution or an
 * undone scramble never does. Browser checks turn it on the virtual cube so the
 * analysis has a real solve to read; tests use it for realistic recorded solves.
 */
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { bestLastLayerAlgorithm, bestPairAlgorithm, crossSolved, pairSolved, PAIR_OUT } from "./alternatives";
import { crossSolver } from "./crossSolver";
import { physicalTurns } from "./physicalTurns";
import { recogniseOll, recognisePll } from "./recognise";

const AUFS = ["", "U", "U2", "U'"];

/** Face turns, in the cube's own frame with the cross on D, that solve `scrambled` by CFOP. */
export function cfopSolution(kpuzzle: KPuzzle, scrambled: KPattern): string[] {
  const moves: string[] = [];
  let state = scrambled;
  const turn = (alg: string) => {
    if (!alg) return;
    const turns = physicalTurns(alg).moves;
    moves.push(...turns);
    state = state.applyAlg(new Alg(turns.join(" ")));
  };

  turn(crossSolver(kpuzzle).solve(state).join(" "));
  for (let guard = 0; guard < 12 && [0, 1, 2, 3].some((i) => !pairSolved(state, i)); guard++) {
    const choices = [0, 1, 2, 3]
      .filter((i) => !pairSolved(state, i))
      .map((i) => bestPairAlgorithm(state, i))
      .filter((choice) => choice.alg !== null)
      .sort((a, b) => a.length - b.length);
    if (choices.length > 0) {
      turn(choices[0].alg!);
      continue;
    }
    // Every pair left is stuck in a slot: free one and look again.
    turn(PAIR_OUT[[0, 1, 2, 3].find((i) => !pairSolved(state, i))!][0]);
  }
  if (!crossSolved(state) || [0, 1, 2, 3].some((i) => !pairSolved(state, i))) {
    throw new Error("No CFOP solution found for this scramble.");
  }

  const oll = recogniseOll(kpuzzle, state);
  if (oll && oll !== "Solved") turn(bestLastLayerAlgorithm(state, "OLL", oll)?.alg ?? "");
  const pll = recognisePll(kpuzzle, state);
  if (pll && pll !== "Solved") turn(bestLastLayerAlgorithm(state, "PLL", pll)?.alg ?? "");
  const auf = AUFS.find((candidate) => state.applyAlg(new Alg(candidate)).isIdentical(kpuzzle.defaultPattern()));
  if (auf === undefined) throw new Error("No CFOP solution found for this scramble.");
  turn(auf);
  return moves;
}

/** The same for a written scramble, for callers without a puzzle to hand (browser checks). */
export async function cfopSolutionForScramble(scramble: string): Promise<string[]> {
  const { get3x3x3 } = await import("./puzzle");
  const kpuzzle = await get3x3x3();
  return cfopSolution(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg(scramble)));
}
