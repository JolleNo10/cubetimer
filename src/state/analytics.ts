/**
 * What a solve could have been.
 *
 * For every step we know the state it started from and the state it ended at, so the
 * shortest route between those two says how much of the step was progress and how much
 * was fumbling. Three different tools answer three different questions:
 *
 *  - the cross has its own exact solver, because "the best cross" means finishing four
 *    edges and does not care what happens to the rest of the cube;
 *  - the other steps are searched exhaustively for something shorter with the same
 *    result, which is a real answer up to the depth the search can reach;
 *  - the last two steps are also compared with the standard algorithm for the case,
 *    which is the alternative a solver would actually learn.
 */
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import type { SolveStep } from "../cube/analysis";
import { crossSolver } from "../cube/crossSolver";
import { OLL_ALGORITHMS, PLL_ALGORITHMS } from "../cube/lastLayerCases";
import { Move } from "cubing/alg";
import { rotationForCrossFace } from "../cube/orientation";
import { findShorter, shortestWholeSolve, type Improvement } from "../cube/optimise";
import { reframe } from "../cube/recognise";
import type { Solve } from "./types";

export type StepAnalytics = Improvement & {
  name: string;
  /** What the solver actually turned, for comparison. */
  moves: string;
  /** A named alternative worth knowing, rather than one the search turned up. */
  reference?: { label: string; alg: string; length: number };
};

export type SolveAnalytics = {
  steps: StepAnalytics[];
  /** The shortest cross available from the scramble, which is always worth knowing. */
  cross: { used: number; length: number; alg: string } | null;
  /** A whole solution to the scramble, as a yardstick for the move count. */
  wholeSolve: { used: number; length: number; alg: string } | null;
};

/**
 * How many moves an algorithm is, the way a cuber counts them.
 *
 * Counted from the parsed algorithm rather than with this app's own move parser, which
 * only knows the face turns a cube reports: written algorithms also use wide moves and
 * slices, and silently skipping those would undercount them. Rotations are free.
 */
function algorithmLength(alg: string): number {
  return Array.from(new Alg(alg).expand().childAlgNodes()).filter((node) => {
    const move = node.as(Move);
    return move === null || !"xyz".includes(move.family);
  }).length;
}

/** The standard algorithm for a last-layer case, as an alternative to compare against. */
function referenceFor(step: SolveStep): StepAnalytics["reference"] {
  const name = step.case;
  if (!name || name === "Solved") return undefined;
  const alg =
    step.name === "OLL"
      ? OLL_ALGORITHMS[Number(name)]
      : step.name === "PLL"
        ? PLL_ALGORITHMS[name]
        : undefined;
  if (!alg) return undefined;
  return {
    label: `${step.name} ${name}`,
    alg,
    length: algorithmLength(alg),
  };
}

/**
 * Work through a solve looking for better ways of doing each step.
 *
 * Steps are reported one at a time through `onStep`, because the searches take long
 * enough that waiting for all of them before showing anything would feel broken.
 */
export async function analyseAlternatives(
  kpuzzle: KPuzzle,
  solve: Solve,
  scrambled: KPattern,
  onStep?: (step: StepAnalytics) => void,
): Promise<SolveAnalytics> {
  const analysis = solve.analysis;
  if (!analysis) return { steps: [], cross: null, wholeSolve: null };

  // States after each move, so any step's boundaries can be looked up.
  const patterns: KPattern[] = [scrambled];
  for (const { move } of solve.moves) {
    patterns.push(patterns[patterns.length - 1].applyMove(move));
  }
  const at = (index: number) => patterns[Math.min(index, patterns.length - 1)];

  // The cross solver works on a cube held cross-down, whichever face that was.
  const facing = reframe(
    kpuzzle,
    scrambled,
    new Alg(rotationForCrossFace(analysis.crossFace).tokens.join(" ")),
  );
  const solver = crossSolver(kpuzzle);
  const crossStep = analysis.steps[0];
  const cross = {
    used: crossStep.sliceTurns,
    length: solver.lengthFrom(facing),
    alg: solver.solve(facing).join(" "),
  };

  const steps: StepAnalytics[] = [];
  for (const step of analysis.steps) {
    const improvement =
      step.sliceTurns === 0
        ? { used: 0, best: null, bestLength: 0, optimal: true, tooDeep: false }
        : await findShorter(kpuzzle, at(step.fromMove), at(step.toMove), step.sliceTurns);
    const entry: StepAnalytics = {
      ...improvement,
      name: step.name,
      moves: step.moves,
      reference: referenceFor(step),
    };
    steps.push(entry);
    onStep?.(entry);
  }

  const whole = await shortestWholeSolve(scrambled);
  return {
    steps,
    cross,
    wholeSolve: whole
      ? { used: analysis.sliceTurns, length: whole.length, alg: whole.alg }
      : null,
  };
}
