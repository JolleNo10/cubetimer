import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import { patternToFacelets } from "./facelets";
import {
  EDGES_OF_FACE,
  FACES,
  FACE_OFFSET,
  OPPOSITE,
  f2lSlotsForCrossFace,
  type Face,
} from "./moves";
import {
  addTurns,
  countTurns,
  formatMoveList,
  mergeSameFaceTurns,
  parseMove,
  type TimedMove,
  type TurnMetrics,
} from "./notation";
import { describeGrip, reorientMoves, rotationForCrossFace } from "./orientation";
import { recogniseOll, recognisePll, reframe } from "./recognise";

export type { TimedMove };

export const STEP_NAMES = [
  "Cross",
  "F2L Slot 1",
  "F2L Slot 2",
  "F2L Slot 3",
  "F2L Slot 4",
  "OLL",
  "PLL",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

/**
 * One phase of a CFOP solve.
 *
 * Times are all in milliseconds, measured from the first turn of the solve. A move's
 * timestamp is the moment that move *finished*, so a step ends at the timestamp of its
 * last move and the next step starts from there.
 */
export type SolveStep = TurnMetrics & {
  name: StepName;
  /** The step written out, in the frame the solver held the cube in. */
  moves: string;
  /** The same moves, each with the time it finished at. */
  recordedMoves: TimedMove[];
  /** True when the step needed no moves at all — a cross skip, a lucky PLL. */
  skipped: boolean;
  hasTurns: boolean;
  timeMs: number;
  /** Time spent looking at the cube before the first move that is not an AUF. */
  recognitionMs: number;
  /** Time spent turning. */
  executionMs: number;
  /** Time from the start of the solve to the end of this step. */
  cumulativeMs: number;
  /** Turns per second while actually turning. */
  tps: number;
  /** Case identifier, when one is known: an OLL number, a PLL name. */
  case: string | null;
  /**
   * Which F2L slot this step filled, as the pair of faces that meet there — `"FR"`,
   * `"BL"` and so on, in the scrambled cube's own frame, so its colours are fixed.
   */
  slot: string | null;
  /** Range of this step within the solve's raw move stream. */
  fromMove: number;
  toMove: number;
};

export type SolveAnalysis = TurnMetrics & {
  method: "CFOP";
  /** Face of the scrambled cube the cross was built on. */
  crossFace: Face;
  /** How the cube was held, as `<bottom face><back face>` of the scrambled cube. */
  rotation: string;
  steps: SolveStep[];
  solvingMs: number;
  /** Turns per second across the whole solve, including thinking time. */
  tps: number;
  totalRecognitionMs: number;
  totalExecutionMs: number;
  stepsSkipped: number;
  /** Moves made after the cube was already solved. */
  turnsAfterSolution: number;
  pauses: { afterMove: number; startMs: number; durationMs: number }[];
};

export const PAUSE_THRESHOLD_MS = 250;

type StateFlags = {
  edgeSolved: boolean[];
  cornerSolved: boolean[];
  faceUniform: boolean[];
  solved: boolean;
};

function flagsFor(pattern: KPattern): StateFlags {
  const edges = pattern.patternData.EDGES;
  const corners = pattern.patternData.CORNERS;
  const edgeSolved = Array.from(
    { length: 12 },
    (_, i) => edges.pieces[i] === i && edges.orientation[i] === 0,
  );
  const cornerSolved = Array.from(
    { length: 8 },
    (_, i) => corners.pieces[i] === i && corners.orientation[i] === 0,
  );
  const facelets = patternToFacelets(pattern);
  const faceUniform = FACES.map((face) => {
    const start = FACE_OFFSET[face];
    for (let i = start; i < start + 9; i++) {
      if (facelets[i] !== face) return false;
    }
    return true;
  });
  return {
    edgeSolved,
    cornerSolved,
    faceUniform,
    solved: edgeSolved.every(Boolean) && cornerSolved.every(Boolean),
  };
}

/** First index in `[lo, hi]` from which `predicate` holds continuously up to `hi`. */
function stableWithin(
  states: StateFlags[],
  lo: number,
  hi: number,
  predicate: (s: StateFlags) => boolean,
): number {
  let i = hi;
  while (i > lo && predicate(states[i - 1])) i--;
  return i;
}

/** First index at or after `lo` where `predicate` holds, or -1. */
function firstFrom(
  states: StateFlags[],
  lo: number,
  predicate: (s: StateFlags) => boolean,
): number {
  for (let i = lo; i < states.length; i++) {
    if (predicate(states[i])) return i;
  }
  return -1;
}

/**
 * Break a solve into its CFOP phases and measure each one.
 *
 * The move stream arrives in the cube's own frame of reference — rotations are not
 * reported over Bluetooth and do not change the state — so the cross face is worked out
 * from the solve itself and the moves are then rewritten into the solver's frame.
 * Returns `null` for solves that do not end solved, or that have no moves.
 */
export function analyseSolve(
  scrambledState: KPattern,
  moves: TimedMove[],
): SolveAnalysis | null {
  if (moves.length === 0) return null;

  const patterns: KPattern[] = [scrambledState];
  for (const { move } of moves) {
    patterns.push(patterns[patterns.length - 1].applyMove(move));
  }
  const states = patterns.map(flagsFor);

  // Turns made after the cube came together do not belong to any step.
  const solvedAt = states.findIndex((state) => state.solved);
  if (solvedAt === -1) return null;
  const endIdx = solvedAt;
  const turnsAfterSolution = moves.length - solvedAt;

  const boundaries = findPhaseBoundaries(states, endIdx);
  if (!boundaries) return null;

  const { crossFace, cuts, slots } = boundaries;
  const rotation = rotationForCrossFace(crossFace);
  const steps: SolveStep[] = [];

  /**
   * The state a step started from, turned so the cross is on the bottom — which is how
   * every last-layer case is defined, whichever way the solver was holding the cube.
   */
  const rotationAlg = new Alg(rotation.tokens.join(" "));
  const stateFacing = (index: number) =>
    reframe(
      scrambledState.kpuzzle,
      patterns[Math.min(index, patterns.length - 1)],
      rotationAlg,
    );

  let from = 0;
  let previousCumulative = 0;
  let totals: TurnMetrics = { sliceTurns: 0, faceTurns: 0, quarterTurns: 0 };

  for (const [index, name] of STEP_NAMES.entries()) {
    const to = Math.max(from, Math.min(cuts[index], endIdx));
    // Merging happens inside a step, never across one, so that the turn counts of the
    // steps always add up to the turn count of the solve.
    const recorded = mergeSameFaceTurns(
      reorientMoves(moves.slice(from, to), rotation.orientation),
    );
    if (index === 0 && rotation.tokens.length > 0 && recorded.length > 0) {
      recorded.unshift(
        ...rotation.tokens.map((token) => ({ move: token, t: recorded[0].t })),
      );
    }

    const turning = recorded.filter((m) => {
      const parsed = parseMove(m.move);
      return parsed !== null && !"xyz".includes(parsed.family);
    });
    const cumulativeMs =
      turning.length > 0 ? turning[turning.length - 1].t : previousCumulative;
    // The cross starts when its first turn lands, not when the timer did.
    const startMs =
      index === 0 ? (turning[0]?.t ?? previousCumulative) : previousCumulative;
    const timeMs = Math.max(0, cumulativeMs - startMs);
    const recognitionMs =
      index === 0 ? 0 : recognitionTime(turning, previousCumulative, timeMs);
    const metrics = countTurns(recorded.map((m) => m.move));
    // A case is whatever the solver was looking at when the step began.
    const kpuzzle = scrambledState.kpuzzle;
    const caseName =
      name === "OLL"
        ? recogniseOll(kpuzzle, stateFacing(from))
        : name === "PLL"
          ? recognisePll(kpuzzle, stateFacing(from))
          : null;
    totals = addTurns(totals, metrics);
    const executionMs = Math.max(0, timeMs - recognitionMs);

    steps.push({
      name,
      moves: formatMoveList(recorded),
      recordedMoves: recorded,
      skipped: turning.length === 0,
      hasTurns: metrics.sliceTurns > 0,
      timeMs,
      recognitionMs,
      executionMs,
      cumulativeMs,
      tps: executionMs > 0 ? (metrics.sliceTurns / executionMs) * 1000 : 0,
      case: caseName,
      // Steps one to four are the F2L pairs, in the order they were finished.
      slot: index >= 1 && index <= 4 ? (slots[index - 1] ?? null) : null,
      fromMove: from,
      toMove: to,
      ...metrics,
    });

    from = to;
    previousCumulative = cumulativeMs;
  }

  const solvingMs = moves[endIdx - 1]?.t ?? 0;
  const pauses: SolveAnalysis["pauses"] = [];
  for (let i = 1; i < endIdx; i++) {
    const gap = moves[i].t - moves[i - 1].t;
    if (gap >= PAUSE_THRESHOLD_MS) {
      pauses.push({ afterMove: i - 1, startMs: moves[i - 1].t, durationMs: gap });
    }
  }

  return {
    method: "CFOP",
    crossFace,
    rotation: describeGrip(rotation.orientation),
    steps,
    solvingMs,
    tps: solvingMs > 0 ? (totals.sliceTurns / solvingMs) * 1000 : 0,
    totalRecognitionMs: steps.reduce((sum, s) => sum + s.recognitionMs, 0),
    totalExecutionMs: steps.reduce((sum, s) => sum + s.executionMs, 0),
    stepsSkipped: steps.filter((s) => s.skipped).length,
    turnsAfterSolution,
    pauses,
    ...totals,
  };
}

/**
 * Time spent looking rather than turning, at the start of a step.
 *
 * Turns of the last layer at the start of a step are the solver lining the cube up for
 * a case they have already recognised — an AUF — so recognition runs until the first
 * turn that actually changes something.
 */
function recognitionTime(
  turning: readonly TimedMove[],
  startMs: number,
  timeMs: number,
): number {
  for (const { move, t } of turning) {
    if (parseMove(move)?.family === "U") continue;
    return Math.max(0, t - startMs);
  }
  return timeMs;
}

/** Where each CFOP phase ends, as an index into the raw move stream. */
function findPhaseBoundaries(
  states: StateFlags[],
  endIdx: number,
): { crossFace: Face; cuts: number[]; slots: (string | null)[] } | null {
  let best: {
    crossFace: Face;
    cuts: number[];
    slots: (string | null)[];
    f2lIdx: number;
  } | null = null;

  for (const face of FACES) {
    const slotDefs = f2lSlotsForCrossFace(face);
    const crossSolved = (s: StateFlags) =>
      EDGES_OF_FACE[face].every((e) => s.edgeSolved[e]);
    const isSlotSolved = (s: StateFlags, d: (typeof slotDefs)[number]) =>
      s.cornerSolved[d.corner] && s.edgeSolved[d.edge];

    const f2lIdx = firstFrom(
      states,
      0,
      (s) => crossSolved(s) && slotDefs.every((d) => isSlotSolved(s, d)),
    );
    if (f2lIdx === -1 || f2lIdx > endIdx) continue;

    // The cross is dated by when it first comes together: F2L triggers on the F, B and
    // L faces routinely disturb a cross edge and put it straight back.
    const crossIdx = Math.min(firstFrom(states, 0, crossSolved), f2lIdx);

    // Pairs are dated by the moment the number of finished slots goes up, rather than
    // by each slot individually: inserting one pair frequently disturbs a neighbouring
    // slot for a few moves, and that must not push the earlier pair's time forward.
    const solvedSlotCount = (st: StateFlags) =>
      slotDefs.filter((d) => isSlotSolved(st, d)).length;
    const slotCuts: number[] = [];
    const slotNames: (string | null)[] = [];
    const filled = new Set<string>();
    let previous = crossIdx;
    for (let k = 1; k <= 4; k++) {
      const idx = firstFrom(states, previous, (st) => solvedSlotCount(st) >= k);
      if (idx === -1) break;
      // Whichever slot was not done a moment ago but is now is the one just filled.
      const justFilled =
        slotDefs.find(
          (d) =>
            !filled.has(d.name) &&
            isSlotSolved(states[idx], d) &&
            (idx === 0 || !isSlotSolved(states[idx - 1], d)),
        ) ??
        slotDefs.find((d) => !filled.has(d.name) && isSlotSolved(states[idx], d));
      if (justFilled) filled.add(justFilled.name);
      slotCuts.push(idx);
      slotNames.push(justFilled?.name ?? null);
      previous = idx;
    }
    if (slotCuts.length < 4) continue;

    const llFaceIndex = FACES.indexOf(OPPOSITE[face]);
    const ollIdx = firstFrom(states, f2lIdx, (s) => s.faceUniform[llFaceIndex]);
    const cuts = [
      crossIdx,
      ...slotCuts,
      ollIdx === -1 ? endIdx : ollIdx,
      endIdx,
    ];

    if (best === null || f2lIdx < best.f2lIdx) {
      best = { crossFace: face, cuts, slots: slotNames, f2lIdx };
    }
  }

  return best
    ? { crossFace: best.crossFace, cuts: best.cuts, slots: best.slots }
    : null;
}

/** Lightweight live check used by the timer to know when to stop. */
export function isSolvedPattern(pattern: KPattern): boolean {
  const edges = pattern.patternData.EDGES;
  const corners = pattern.patternData.CORNERS;
  for (let i = 0; i < 12; i++) {
    if (edges.pieces[i] !== i || edges.orientation[i] !== 0) return false;
  }
  for (let i = 0; i < 8; i++) {
    if (corners.pieces[i] !== i || corners.orientation[i] !== 0) return false;
  }
  return true;
}

export { stableWithin };
