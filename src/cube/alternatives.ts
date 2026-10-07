/**
 * What a solve could have been.
 *
 * Four different questions, each with its own tool:
 *
 *  - **the same result, shorter**: every step is searched exhaustively for a shorter
 *    way to the exact state it ended at (`findShorter`), which says how much of the
 *    step was progress and how much was fumbling;
 *  - **a different pair**: at the start of each F2L step every unsolved pair is read as
 *    a case and given the shortest catalogue algorithm that actually solves it from
 *    there — so "you did FL in 11 moves; BR was a 3-mover" can be said;
 *  - **a different order**: from the end of the cross, every order of the four pairs is
 *    tried with those algorithms, which is what "best pair order" means;
 *  - **the cross**: the shortest cross, and the shortest XCross and XXCross within a few
 *    moves of it (`planCross`);
 *  - **the last layer**: the shortest catalogue algorithm for the one-look case, which
 *    is what a two-look solver would learn next.
 *
 * Everything is worked out on the cube turned cross-down, the frame the analysis names
 * cases in. Each alternative is written in that frame for reading, and as face turns of
 * the cube's own frame (`cubeMoves`) so it can be played back on a replay.
 */
import { Alg, Move } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import type { SolveAnalysis, StepName, TimedMove } from "./analysis";
import { F2L_ALG_BANK, OLL_ALG_BANK, PLL_ALG_BANK } from "./algBank.generated";
import { ADVANCED_F2L_CASES } from "./advancedF2lCases.generated";
import { crossSolver } from "./crossSolver";
import { planCross } from "./crossPlans";
import { F2L_SLOTS, recognizeAnyF2lSlot } from "./f2l";
import { F2L_POSITIONS, type F2lPosition } from "./f2lCases";
import { EDGES_OF_FACE, type Face } from "./moves";
import { findShorter, shortestWholeSolve, type Improvement } from "./optimise";
import { gripFaces, rotationForCrossFace, slotInCubeFrame, type Orientation } from "./orientation";
import { joinMoves } from "./notation";
import { physicalTurns } from "./physicalTurns";
import { reframe } from "./recognise";

/** A sequence to show and to play. */
export type Alternative = {
  /** Written cross-down, as the solver would turn it. */
  alg: string;
  /** Moves, the way a cuber counts them: wide moves and slices are one, rotations free. */
  length: number;
  /** Raw move index of the state it starts from. */
  fromMove: number;
  /** The same sequence as face turns of the cube's own frame, for playback. */
  cubeMoves: string[];
};

export type PairChoice = {
  /** The pair's slot, in the scrambled cube's own frame (`"FR"`, `"BL"`…), as `SolveStep.slot`. */
  slot: string;
  /** The same slot, cross-down: where it is in the solver's hands. */
  position: F2lPosition;
  /** The case it stood as, or null when it is stuck where no catalogue case applies. */
  case: string | null;
  /** The shortest catalogue algorithm that solves it from here, AUF included. */
  best: Alternative | null;
  /** True for the pair the solver actually did next. */
  chosen: boolean;
};

export type StepAlternatives = {
  name: StepName;
  /** Moves the solver used for this step. */
  used: number;
  /** The shortest way to the very same state; `best` playable through `sameResultMoves`. */
  sameResult: Improvement;
  sameResultMoves: string[] | null;
  /** F2L steps: every pair that could have gone in next. */
  pairChoices?: PairChoice[];
  /** OLL and PLL: the shortest one-look algorithm for the case faced. */
  reference?: Alternative & { label: string };
};

export type SolveAlternatives = {
  /** How the cube was held for every sequence: which face is `R` depends on it. */
  grip: { bottom: Face; front: Face };
  cross: {
    used: number;
    best: Alternative;
    /** Shortest cross that also finishes one pair, and two, when there is one close by. */
    xcross: (Alternative & { pairs: string[] }) | null;
    xxcross: (Alternative & { pairs: string[] }) | null;
  } | null;
  /**
   * The pairs in the order that takes fewest moves with catalogue algorithms, played
   * from the end of the cross. `parts` is the same sequence pair by pair.
   */
  pairOrder: (Alternative & { used: number; order: string[]; parts: { slot: string; alg: string; length: number }[] }) | null;
  steps: StepAlternatives[];
  /** A computer solution of the whole scramble, as a yardstick. */
  wholeSolve: (Alternative & { used: number }) | null;
};

/** How many moves an algorithm is, the way a cuber counts them. */
export function algorithmLength(alg: string): number {
  return Array.from(new Alg(alg).expand().childAlgNodes()).filter((node) => {
    const move = node.as(Move);
    return move === null || !"xyz".includes(move.family);
  }).length;
}

const AUFS = ["", "U", "U2", "U'"];
const PAIRS = F2L_SLOTS;
const CROSS_EDGES = EDGES_OF_FACE.D;

export function crossSolved(pattern: KPattern): boolean {
  const { EDGES } = pattern.patternData;
  return CROSS_EDGES.every((e) => EDGES.pieces[e] === e && EDGES.orientation[e] === 0);
}

export function pairSolved(pattern: KPattern, index: number): boolean {
  const { EDGES, CORNERS } = pattern.patternData;
  const { edge, corner } = PAIRS[index];
  return EDGES.pieces[edge] === edge && EDGES.orientation[edge] === 0
    && CORNERS.pieces[corner] === corner && CORNERS.orientation[corner] === 0;
}

function applyHeld(pattern: KPattern, alg: string): KPattern | null {
  try {
    return pattern.applyAlg(new Alg(physicalTurns(alg).moves.join(" ")));
  } catch {
    return null;
  }
}

/** Catalogue algorithms that could solve a pair in `position`, basic and advanced. */
function algorithmsFor(caseName: string, position: F2lPosition): readonly string[] {
  if (caseName.startsWith("AF2L")) {
    return ADVANCED_F2L_CASES.find((entry) => entry.name === caseName)?.algorithms[position] ?? [];
  }
  return F2L_ALG_BANK[caseName]?.[position] ?? [];
}

/**
 * The shortest catalogue way to put one pair in from `pattern` (cross-down), keeping the
 * cross and every pair already in. Checked by applying it, not looked up: whatever an
 * algorithm is filed under, either the pair goes in or it does not.
 */
export function bestPairAlgorithm(
  pattern: KPattern,
  index: number,
): { case: string | null; alg: string | null; length: number; after: KPattern | null } {
  const direct = catalogueInsert(pattern, index);
  if (direct.alg) return direct;
  const freed = freeThenInsert(pattern, index);
  return freed ? { case: direct.case, ...freed } : direct;
}

/** The shortest catalogue algorithm that puts pair `index` in from here, if there is one. */
function catalogueInsert(
  pattern: KPattern,
  index: number,
): { case: string | null; alg: string | null; length: number; after: KPattern | null } {
  const position = F2L_POSITIONS[index];
  const caseName = recognizeAnyF2lSlot(pattern.kpuzzle, pattern, position)?.name ?? null;
  if (!caseName) return { case: null, alg: null, length: 0, after: null };
  const keep = PAIRS.map((_, i) => i).filter((i) => i !== index && pairSolved(pattern, i));
  let best: { alg: string; length: number; after: KPattern } | null = null;
  for (const algorithm of algorithmsFor(caseName, position)) {
    for (const auf of AUFS) {
      // A lining-up turn runs into an algorithm that opens with one: `U'` and `U' F'` is `U2 F'`.
      const alg = joinMoves(auf ? [auf] : [], algorithm.split(" ")).join(" ");
      const length = algorithmLength(alg);
      if (best && length >= best.length) continue;
      const after = applyHeld(pattern, alg);
      if (!after || !crossSolved(after) || !pairSolved(after, index)) continue;
      if (!keep.every((i) => pairSolved(after, i))) continue;
      best = { alg, length, after };
    }
  }
  return best ? { case: caseName, ...best } : { case: caseName, alg: null, length: 0, after: null };
}

/**
 * Turns that take whatever is in a slot out to the last layer, per slot (FR, FL, BL,
 * BR), the way a solver frees a stuck piece: up with the slot's side face, a U, back.
 */
export const PAIR_OUT: readonly (readonly string[])[] = [
  ["R U R'", "R U' R'", "R U2 R'"],
  ["L' U' L", "L' U L", "L' U2 L"],
  ["L U L'", "L U' L'", "L U2 L'"],
  ["R' U' R", "R' U R", "R' U2 R"],
];

/**
 * For a pair with no catalogue answer — a piece stuck where no case applies — free one
 * slot that is not done yet and insert from there: the shortest such pair-out and
 * algorithm together, checked like any other.
 */
function freeThenInsert(pattern: KPattern, index: number): { alg: string; length: number; after: KPattern } | null {
  let best: { alg: string; length: number; after: KPattern } | null = null;
  for (const slot of PAIRS.map((_, i) => i).filter((i) => !pairSolved(pattern, i))) {
    for (const out of PAIR_OUT[slot]) {
      const freed = applyHeld(pattern, out);
      if (!freed || !crossSolved(freed)) continue;
      const insert = catalogueInsert(freed, index);
      if (!insert.alg || !insert.after) continue;
      const keep = PAIRS.map((_, i) => i).filter((i) => i !== index && pairSolved(pattern, i));
      if (!keep.every((i) => pairSolved(insert.after!, i))) continue;
      const length = algorithmLength(out) + insert.length;
      if (!best || length < best.length) best = { alg: `${out} ${insert.alg}`, length, after: insert.after };
    }
  }
  return best;
}

/** Last-layer goals: oriented with F2L kept, or solved but for an AUF. */
function lastLayerDone(pattern: KPattern, family: "OLL" | "PLL"): boolean {
  if (!PAIRS.every((_, i) => pairSolved(pattern, i)) || !crossSolved(pattern)) return false;
  const { EDGES, CORNERS } = pattern.patternData;
  for (let i = 0; i < 4; i++) {
    if (EDGES.orientation[i] !== 0 || CORNERS.orientation[i] !== 0) return false;
    if (family === "PLL" && (EDGES.pieces[i] !== i || CORNERS.pieces[i] !== i)) return false;
  }
  return true;
}

export function bestLastLayerAlgorithm(pattern: KPattern, family: "OLL" | "PLL", caseName: string) {
  const bank = family === "OLL" ? OLL_ALG_BANK : PLL_ALG_BANK;
  let best: { alg: string; length: number } | null = null;
  for (const algorithm of bank[caseName] ?? []) {
    for (const before of AUFS) {
      for (const after of family === "PLL" ? AUFS : [""]) {
        const alg = joinMoves(before ? [before] : [], algorithm.split(" "), after ? [after] : []).join(" ");
        const length = algorithmLength(alg);
        if (best && length >= best.length) continue;
        const done = applyHeld(pattern, alg);
        if (done && lastLayerDone(done, family)) best = { alg, length };
      }
    }
  }
  return best;
}

/**
 * The cheapest order for the pairs still to do, trying every one.
 *
 * Each pair is put in with its shortest catalogue algorithm from wherever the cube is by
 * then, so the order also decides which cases come up. A pair with no catalogue answer
 * at some point closes that branch.
 */
function bestOrder(pattern: KPattern): { length: number; order: number[]; parts: { alg: string; length: number }[] } | null {
  const remaining = PAIRS.map((_, i) => i).filter((i) => !pairSolved(pattern, i));
  if (remaining.length === 0) return { length: 0, order: [], parts: [] };
  let best: ReturnType<typeof bestOrder> = null;
  for (const index of remaining) {
    const step = bestPairAlgorithm(pattern, index);
    if (!step.alg || !step.after) continue;
    const rest = bestOrder(step.after);
    if (!rest) continue;
    const length = step.length + rest.length;
    if (!best || length < best.length) {
      best = { length, order: [index, ...rest.order], parts: [{ alg: step.alg, length: step.length }, ...rest.parts] };
    }
  }
  return best;
}

export type AlternativesInput = {
  analysis: SolveAnalysis;
  moves: readonly TimedMove[];
  /** The cube as scrambled, in its own frame. */
  scrambled: KPattern;
};

/**
 * Work through a solve looking for better ways of doing each part of it.
 *
 * Results arrive through `onProgress` as each part is done, because the searches take
 * long enough that waiting for all of them would feel broken. The analysis has to be
 * one the caller trusts: alternatives to a misread solve are alternatives to something
 * that did not happen.
 */
export async function analyseSolveAlternatives(
  kpuzzle: KPuzzle,
  { analysis, moves, scrambled }: AlternativesInput,
  onProgress?: (partial: SolveAlternatives, done: number, total: number) => void,
): Promise<SolveAlternatives> {
  const rotation = rotationForCrossFace(analysis.crossFace);
  const rotationAlg = new Alg(rotation.tokens.join(" "));
  const crossDown: Orientation = rotation.orientation;
  const toCube = (alg: string) => physicalTurns(alg, crossDown).moves;
  const playable = (alg: string, fromMove: number): Alternative => ({
    alg,
    length: algorithmLength(alg),
    fromMove,
    cubeMoves: toCube(alg),
  });

  const patterns: KPattern[] = [scrambled];
  for (const { move } of moves) patterns.push(patterns[patterns.length - 1].applyMove(move));
  const at = (index: number) => reframe(kpuzzle, patterns[Math.min(index, patterns.length - 1)], rotationAlg);
  const slotOf = (position: F2lPosition) => slotInCubeFrame(crossDown, position);

  const result: SolveAlternatives = {
    grip: gripFaces(crossDown),
    cross: null,
    pairOrder: null,
    steps: [],
    wholeSolve: null,
  };
  const total = analysis.steps.length + 3;
  let done = 0;
  const report = () => onProgress?.(result, ++done, total);
  // Give the page a chance to draw between the heavier pieces of work.
  const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

  const start = at(0);
  const crossStep = analysis.steps[0];
  const solver = crossSolver(kpuzzle);
  const plans = planCross(kpuzzle, start, { extra: 3 });
  const withPairs = (count: number) => {
    const plan = plans.plans.find((candidate) => candidate.pairs.length >= count);
    return plan ? { ...playable(plan.moves.join(" "), 0), pairs: plan.pairs } : null;
  };
  result.cross = {
    used: crossStep.sliceTurns,
    best: playable(solver.solve(start).join(" "), 0),
    xcross: withPairs(1),
    xxcross: withPairs(2),
  };
  report();
  await breathe();

  for (const step of analysis.steps) {
    const sameResult = step.sliceTurns === 0
      ? { used: 0, best: null, bestLength: 0, optimal: true, tooDeep: false }
      : await findShorter(kpuzzle, at(step.fromMove), at(step.toMove), step.sliceTurns);
    const entry: StepAlternatives = {
      name: step.name,
      used: step.sliceTurns,
      sameResult,
      sameResultMoves: sameResult.best ? toCube(sameResult.best) : null,
    };
    const from = at(step.fromMove);
    if (step.slot && step.fromMove < step.toMove) {
      entry.pairChoices = PAIRS.map((_, index) => index)
        .filter((index) => !pairSolved(from, index))
        .map((index) => {
          const choice = bestPairAlgorithm(from, index);
          return {
            slot: slotOf(F2L_POSITIONS[index]),
            position: F2L_POSITIONS[index],
            case: choice.case,
            best: choice.alg ? playable(choice.alg, step.fromMove) : null,
            chosen: slotOf(F2L_POSITIONS[index]) === step.slot,
          };
        });
    }
    if ((step.name === "OLL" || step.name === "PLL") && step.case && step.case !== "Solved" && step.fromMove < step.toMove) {
      const reference = bestLastLayerAlgorithm(from, step.name, step.case);
      if (reference) entry.reference = { ...playable(reference.alg, step.fromMove), label: `${step.name} ${step.case}` };
    }
    result.steps.push(entry);
    report();
    await breathe();
  }

  // From the cube as it stood once the cross was in, as the solver had it.
  const afterCross = analysis.steps[0].toMove;
  const order = bestOrder(at(afterCross));
  if (order && order.order.length > 0) {
    result.pairOrder = {
      ...playable(order.parts.map((part) => part.alg).join(" "), afterCross),
      length: order.length,
      used: analysis.steps.slice(1, 5).reduce((sum, step) => sum + step.sliceTurns, 0),
      order: order.order.map((index) => slotOf(F2L_POSITIONS[index])),
      parts: order.parts.map((part, i) => ({ slot: slotOf(F2L_POSITIONS[order.order[i]]), ...part })),
    };
  }
  report();
  await breathe();

  const whole = await shortestWholeSolve(start);
  if (whole) result.wholeSolve = { ...playable(whole.alg, 0), length: whole.length, used: analysis.sliceTurns };
  report();
  return result;
}
