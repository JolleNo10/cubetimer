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
import { describeGrip, reorientMoves, rotationForCrossFace, slotInCubeFrame, slotInHeldFrame } from "./orientation";
import { rewriteWithRotations, type SolveGrip } from "./gripTrack";
import { recogniseOll, recognisePll, reframe } from "./recognise";
import { F2L_POSITIONS } from "./f2lCases";
import { isF2lSolved } from "./algBank";
import {
  f2lExecution,
  lastLayerLooks,
  lookupAlgorithm,
  type ExecutedAlg,
  type LastLayerLook,
  type StepInput,
} from "./stepExecution";

export type { TimedMove, ExecutedAlg, LastLayerLook };

/**
 * What the analysis records, as a version. Stored analyses older than this are rebuilt
 * from the solve's raw facts when those facts are still there.
 *
 * 2: F2L steps carry the catalogue case they started from.
 * 3: Canonical CFOP checkpoints and explicit evidence-based quality.
 * 4: Complete candidate coherence and independent gyro evidence.
 * 5: Milestones dated by when they stick, the cross face by which face the solve made
 *    progress on, and cases by what was executed (`executedAlg`, `looks`).
 */
export const ANALYSIS_VERSION = 5;

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
  /**
   * Case identifier, when one is known: an OLL number, a PLL name, or an F2L catalogue
   * case (`"F2L 12"`) for a pair that started as one of the 41 cases.
   */
  case: string | null;
  /**
   * Which F2L slot this step filled, as the pair of faces that meet there — `"FR"`,
   * `"BL"` and so on, in the scrambled cube's own frame, so its colours are fixed.
   */
  slot: string | null;
  /**
   * Where an F2L pair went in relative to the solver's hands when it was finished —
   * `"FR"` for a pair inserted at front-right after any rotations. Measured from the
   * grip track when there is one, otherwise inferred from the turns (see
   * `inferInsertionPosition`). Missing on analyses from before version 3.
   */
  insertedAt?: string | null;
  /** Whether `insertedAt` came from the recorded grip or was inferred from the turns. */
  insertedAtSource?: "grip" | "inferred";
  /** Range of this step within the solve's raw move stream. */
  fromMove: number;
  toMove: number;
  /**
   * The step whose moves finished this one, when it was not its own: an F2L pair
   * that went in with the cross (an xcross) or with the pair before it. Such a step
   * has no moves but was not a skip.
   */
  solvedDuring?: StepName;
  /** Raw move index the case was read at; later than `fromMove` when the pair was set up first. */
  caseAt?: number;
  /** Turns spent before the case, AUF excluded: pulling a pair out, a keyhole, another pair. */
  setupMoves?: number;
  /** The catalogue algorithm the step ended with, when it was one. */
  executedAlg?: ExecutedAlg | null;
  /** OLL and PLL: the looks the step was done in, one for a one-look step. */
  looks?: LastLayerLook[];
};

export type CfopAnalysisIssue =
  | { code: "cross-face-conflict"; observed: Face; inferred: Face; source?: "solve-start" | "whole-solve-gyro" }
  | { code: "incoherent-cfop-progression" }
  | { code: "ambiguous-cross"; candidates: Face[] }
  | { code: "unassigned-f2l-slot"; step: StepName }
  | { code: "unrecognized-oll" }
  | { code: "unrecognized-pll" };

/** Independent orientation evidence, never reconstructed CFOP conclusions. */
export type CfopAnalysisEvidence = {
  observedStartBottomFace?: Face;
  trackedBottomFace?: Face;
};

export type CfopAnalysisQuality = {
  status: "trusted" | "suspect";
  issues: CfopAnalysisIssue[];
};

export type SolveAnalysis = TurnMetrics & {
  method: "CFOP";
  /** Optional only for compatibility with legacy/imported analysis. */
  quality?: CfopAnalysisQuality;
  /** The `ANALYSIS_VERSION` this was made under; missing on analyses from before versions. */
  analysisVersion?: number;
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

/** Legacy or inconsistent quality metadata cannot authorize derived CFOP analytics. */
export function isTrustedCfopAnalysis(analysis: SolveAnalysis | null | undefined): analysis is SolveAnalysis & { quality: CfopAnalysisQuality } {
  return analysis?.method === "CFOP" && analysis.analysisVersion === ANALYSIS_VERSION
    && analysis.quality?.status === "trusted" && Array.isArray(analysis.quality.issues)
    && analysis.quality.issues.length === 0;
}

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

const F2L_HELD_SLOTS = ["FR", "FL", "BR", "BL"] as const;

function middleLayerSlot(slot: string | null): string | null {
  return slot && (F2L_HELD_SLOTS as readonly string[]).includes(slot) ? slot : null;
}

/** The face on your right when the given side face is in front of you, cross down. */
const RIGHT_OF: Partial<Record<Face, Face>> = { F: "R", R: "B", B: "L", L: "F" };

/**
 * Where a pair was inserted relative to the solver, when no grip was recorded.
 *
 * Face turns cannot show a cube rotation, so the same physical insertion could have been
 * made from any side. Solvers rotate a slot to the front and insert with the side face
 * (`R U R'`, `L' U' L`), so the slot face turned most is taken to be the solver's R or L
 * and the other slot face to be the front: front-right or front-left. On a tie the slot
 * face turned last — the one that drops the pair in — is the side face. Insertions made
 * mainly with the front face, or into a back slot without rotating, read as their mirror;
 * a pair placed without turning either slot face is unknown. `slot` and `moves` are both
 * in the cross-down frame.
 */
export function inferInsertionPosition(slot: string | null, moves: readonly string[]): string | null {
  if (!slot || slot.length !== 2) return null;
  const [a, b] = [...slot] as Face[];
  if (!RIGHT_OF[a] || !RIGHT_OF[b]) return null;
  const turns = (face: Face) => moves.reduce((sum, move) => {
    const parsed = parseMove(move);
    return parsed?.family === face ? sum + Math.abs(parsed.amount) : sum;
  }, 0);
  const [ta, tb] = [turns(a), turns(b)];
  let side: Face;
  if (ta !== tb) side = ta > tb ? a : b;
  else {
    const last = [...moves].reverse().map(parseMove).find((parsed) => parsed?.family === a || parsed?.family === b);
    if (!last) return null;
    side = last.family as Face;
  }
  const front = side === a ? b : a;
  return RIGHT_OF[front] === side ? "FR" : "FL";
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
  grip?: SolveGrip | null,
  evidence: CfopAnalysisEvidence = {},
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

  const boundaries = findPhaseBoundaries(states, patterns, endIdx, evidence);
  if (!boundaries) return null;

  const { crossFace, slots, solvedDuring, issues } = boundaries;
  const rotation = rotationForCrossFace(crossFace);
  /** The solve as the cube reported it, turned so the cross is underneath. */
  const crossDown = reorientMoves(moves, rotation.orientation).map((m) => m.move);
  const cuts = extendToAlgorithms(boundaries, states, crossDown);
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

  const kpuzzle = scrambledState.kpuzzle;
  const positionOf = (slot: string) =>
    F2L_POSITIONS.find((candidate) => slotInCubeFrame(rotation.orientation, candidate) === slot);

  let from = 0;
  let previousCumulative = 0;
  let totals: TurnMetrics = { sliceTurns: 0, faceTurns: 0, quarterTurns: 0 };

  for (const [index, name] of STEP_NAMES.entries()) {
    const to = Math.max(from, Math.min(cuts[index], endIdx));
    // Merging happens inside a step, never across one, so that the turn counts of the
    // steps always add up to the turn count of the solve.
    const turned = moves.slice(from, to);
    const recorded = mergeSameFaceTurns(
      grip
        ? rewriteWithRotations(
            turned,
            grip.orientations.slice(from, to),
            from > 0 ? (grip.orientations[from - 1] ?? null) : null,
          )
        : reorientMoves(turned, rotation.orientation),
    );
    // The rotation goes in front of the whole solve, and has to be there even when
    // the cross itself took no moves: every step after it is written in the turned
    // frame, so without it the solution would refer to the wrong faces.
    const opening = grip ? grip.inspection : rotation.tokens;
    if (index === 0 && opening.length > 0) {
      const at = recorded[0]?.t ?? moves[0]?.t ?? 0;
      recorded.unshift(...opening.map((token) => ({ move: token, t: at })));
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
    const metrics = countTurns(recorded.map((m) => m.move));
    const slot = index >= 1 && index <= 4 ? (slots[index - 1] ?? null) : null;
    const insertion = slot && to > from
      ? grip
        ? { insertedAt: middleLayerSlot(slotInHeldFrame(grip.orientations[to - 1] ?? grip.orientations[0], slot)), insertedAtSource: "grip" as const }
        : { insertedAt: inferInsertionPosition(slotInHeldFrame(rotation.orientation, slot), reorientMoves(turned, rotation.orientation).map((m) => m.move)), insertedAtSource: "inferred" as const }
      : {};
    const input: StepInput = {
      kpuzzle,
      facing: stateFacing,
      tokens: crossDown.slice(from, to),
      moves: turned,
      from,
      to,
      startMs: previousCumulative,
    };
    let recognitionMs = index === 0 ? 0 : recognitionTime(turning, previousCumulative, timeMs);
    let caseName: string | null = null;
    let execution: Pick<SolveStep, "caseAt" | "setupMoves" | "executedAlg" | "looks"> = {};
    const position = slot ? positionOf(slot) : undefined;
    if (position) {
      const f2l = f2lExecution(input, position);
      caseName = f2l.case;
      if (to > from) {
        recognitionMs = Math.min(timeMs, f2l.recognitionMs);
        execution = { caseAt: f2l.caseAt, setupMoves: f2l.setupMoves, executedAlg: f2l.executedAlg };
      }
    } else if (name === "OLL" || name === "PLL") {
      // A case is whatever the solver was looking at when the step began; the looks
      // say how they actually went about it.
      caseName = name === "OLL" ? recogniseOll(kpuzzle, stateFacing(from)) : recognisePll(kpuzzle, stateFacing(from));
      const looks = lastLayerLooks(input, name, (i) => isF2lSolved(stateFacing(i)), PAUSE_THRESHOLD_MS);
      if (looks.length > 0) {
        recognitionMs = Math.min(timeMs, looks.reduce((sum, look) => sum + look.recognitionMs, 0));
        execution = {
          looks,
          executedAlg: looks.length === 1 && looks[0].alg
            ? { family: name, alg: looks[0].alg, fromMove: looks[0].fromMove, toMove: looks[0].toMove }
            : null,
        };
      }
    }
    if (index >= 1 && index <= 4 && !slot) issues.push({ code: "unassigned-f2l-slot", step: name });
    if (turning.length > 0 && caseName === null) {
      if (name === "OLL") issues.push({ code: "unrecognized-oll" });
      if (name === "PLL") issues.push({ code: "unrecognized-pll" });
    }
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
      slot,
      ...insertion,
      fromMove: from,
      toMove: to,
      ...(solvedDuring[index] ? { solvedDuring: solvedDuring[index] } : {}),
      ...execution,
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
    analysisVersion: ANALYSIS_VERSION,
    quality: { status: issues.length ? "suspect" : "trusted", issues },
    crossFace,
    // The grip the solve was written in: the one measured, when there was a gyroscope
    // to measure it, and otherwise the one the cross face implies.
    rotation: describeGrip(grip?.orientations[0] ?? rotation.orientation),
    steps,
    solvingMs,
    tps: solvingMs > 0 ? (totals.sliceTurns / solvingMs) * 1000 : 0,
    totalRecognitionMs: steps.reduce((sum, s) => sum + s.recognitionMs, 0),
    totalExecutionMs: steps.reduce((sum, s) => sum + s.executionMs, 0),
    stepsSkipped: steps.filter((s) => s.skipped && !s.solvedDuring).length,
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

/**
 * How long a milestone may come undone and still count as reached.
 *
 * F2L triggers on the side faces routinely knock a cross edge out and put it straight
 * back (`F' U' F`, a keyhole `D R U R' D'`), and inserting one pair often disturbs the
 * pair beside it for a few turns. Anything longer is the milestone genuinely being
 * broken and rebuilt, and the rebuild is when it was reached.
 */
const CROSS_DIP = 6;
const SLOT_DIP = 6;

/** Whether `predicate` holds at `i` and never fails for more than `maxDip` states running up to `end`. */
function heldFrom(
  states: StateFlags[],
  i: number,
  end: number,
  predicate: (s: StateFlags) => boolean,
  maxDip: number,
): boolean {
  if (!predicate(states[i])) return false;
  let run = 0;
  for (let j = i + 1; j <= end; j++) {
    run = predicate(states[j]) ? 0 : run + 1;
    if (run > maxDip) return false;
  }
  return true;
}

/** First index in `[lo, end]` from which `predicate` is held, or `end`. */
function firstHeld(
  states: StateFlags[],
  lo: number,
  end: number,
  predicate: (s: StateFlags) => boolean,
  maxDip: number,
): number {
  for (let i = lo; i < end; i++) {
    if (heldFrom(states, i, end, predicate, maxDip)) return i;
  }
  return end;
}

type Boundaries = {
  crossFace: Face;
  cuts: number[];
  slots: (string | null)[];
  /** Per step, the earlier step whose moves finished it, if any. */
  solvedDuring: (StepName | undefined)[];
  issues: CfopAnalysisIssue[];
};

/**
 * How close to the best face another face's progress has to be to count as a genuine
 * alternative. Symmetric solves (`M2`, `R2 F2 R2 F2`) tie exactly; a real solve's cross
 * face is far ahead of every other.
 */
const COMPETING_PROGRESS = 0.95;

/**
 * Where each CFOP phase ends, as an index into the raw move stream.
 *
 * The cross face is the one the solve made progress on: cross edges and pairs of that
 * face in place, added up over every state of the solve. Choosing by which face first
 * shows a finished F2L is fooled by coincidences — a last layer one turn from done can
 * be one turn from an F2L on another face too — whereas the face really being solved is
 * in place for most of the solve. A face whose first two layers were done before the
 * first turn wins outright.
 *
 * Independent evidence of the face held underneath settles faces that are genuinely
 * competing; evidence against a face that is clearly ahead is reported as a conflict,
 * and competing faces with no evidence as ambiguity. Either makes the analysis suspect.
 *
 * Each milestone is then dated by when it was reached for good (see `CROSS_DIP`), not by
 * the first moment it happened to be true.
 */
type Candidate = {
  face: Face;
  crossIdx: number;
  f2lIdx: number;
  ollIdx: number;
  score: number;
  /** Cross, F2L and the oriented last layer first appearing in one later state, with no pairs prepared. */
  collapsed: boolean;
  unrecognizedLastLayer: number;
};

function candidateFor(
  states: StateFlags[],
  patterns: readonly KPattern[],
  endIdx: number,
  face: Face,
): Candidate | null {
  const slotDefs = f2lSlotsForCrossFace(face);
  const crossSolved = (s: StateFlags) => EDGES_OF_FACE[face].every((e) => s.edgeSolved[e]);
  const f2lDone = (s: StateFlags) =>
    crossSolved(s) && slotDefs.every((d) => s.cornerSolved[d.corner] && s.edgeSolved[d.edge]);
  const f2lIdx = firstFrom(states, 0, f2lDone);
  if (f2lIdx === -1 || f2lIdx > endIdx) return null;
  const llFaceIndex = FACES.indexOf(OPPOSITE[face]);
  const found = firstFrom(states, f2lIdx, (s) => s.faceUniform[llFaceIndex] && f2lDone(s));
  const ollIdx = found === -1 || found > endIdx ? endIdx : found;
  // Compared between faces by when it first appeared, which a coincidence cannot fake
  // later; when it stuck is a question for the dating once the face is chosen.
  const crossIdx = firstFrom(states, 0, crossSolved);
  let score = 0;
  for (let i = 0; i <= endIdx; i++) {
    const s = states[i];
    for (const e of EDGES_OF_FACE[face]) if (s.edgeSolved[e]) score++;
    for (const d of slotDefs) if (s.cornerSolved[d.corner] && s.edgeSolved[d.edge]) score += 2;
  }
  // A first two layers already done before the first turn is no coincidence: the
  // solve was only ever the last layer, on that face.
  if (f2lIdx === 0) score += 1_000_000;
  const kpuzzle = patterns[0].kpuzzle;
  const rotation = new Alg(rotationForCrossFace(face).tokens.join(" "));
  const facing = (index: number) => reframe(kpuzzle, patterns[index], rotation);
  const prepared = slotDefs.every((d) => states[0].cornerSolved[d.corner] && states[0].edgeSolved[d.edge]);
  return {
    face,
    crossIdx,
    f2lIdx,
    ollIdx,
    score,
    collapsed: crossIdx > 0 && crossIdx === f2lIdx && f2lIdx === ollIdx && !prepared,
    unrecognizedLastLayer:
      Number(ollIdx > f2lIdx && recogniseOll(kpuzzle, facing(f2lIdx)) === null) +
      Number(endIdx > ollIdx && recognisePll(kpuzzle, facing(ollIdx)) === null),
  };
}

/**
 * Whether `a` explains the solve at least as well as `b` and strictly better somewhere:
 * every checkpoint no later, and no worse at naming the last layer.
 *
 * Deliberately not "`a` oriented its last layer before `b` finished F2L, so `b` is a
 * coincidence". One turn before the end of any solve, the face opposite the last turn
 * shows a finished F2L under a uniform face, so that rule hands every full last-layer
 * skip to the wrong face. Late coincidences are left to the progress score instead.
 */
function dominates(a: Candidate, b: Candidate): boolean {
  const left = [a.crossIdx, a.f2lIdx, a.ollIdx, a.unrecognizedLastLayer];
  const right = [b.crossIdx, b.f2lIdx, b.ollIdx, b.unrecognizedLastLayer];
  return left.every((value, i) => value <= right[i]) && left.some((value, i) => value < right[i]);
}

/**
 * Where each CFOP phase ends, as an index into the raw move stream.
 *
 * Choosing the cross face takes three passes. A face whose cross, F2L and oriented last
 * layer all first appear together in one later state is not a CFOP explanation, and a
 * face dominated by another (see `dominates`) is a coincidence. Among what is left the
 * cross face is the one the solve made progress on: its cross edges and pairs in place,
 * added up over every state of the solve. The face really being solved is in place for
 * most of the solve, where a coincidence — a last layer one turn from done can be one
 * turn from an F2L on another face too — lasts a move or two.
 *
 * Independent evidence of the face held underneath settles faces that are genuinely
 * competing (see `COMPETING_PROGRESS`); evidence against a face that is clearly ahead
 * is reported as a conflict, and competing faces with no evidence as ambiguity.
 *
 * Each milestone is then dated by when it was reached for good (see `CROSS_DIP`), not by
 * the first moment it happened to be true.
 */
function findPhaseBoundaries(
  states: StateFlags[],
  patterns: readonly KPattern[],
  endIdx: number,
  evidence: CfopAnalysisEvidence,
): Boundaries | null {
  const candidates = FACES.flatMap((face) => candidateFor(states, patterns, endIdx, face) ?? []);
  if (candidates.length === 0) return null;
  const coherent = candidates.some((candidate) => !candidate.collapsed)
    ? candidates.filter((candidate) => !candidate.collapsed)
    : candidates;
  const frontier = coherent.filter((candidate) => !coherent.some((other) => dominates(other, candidate)));

  const top = Math.max(...frontier.map((candidate) => candidate.score));
  const competing = frontier.filter((candidate) => candidate.score >= top * COMPETING_PROGRESS);
  const leader = competing.find((candidate) => candidate.score === top)!;
  const bottom = evidence.observedStartBottomFace ?? evidence.trackedBottomFace;
  const source = evidence.observedStartBottomFace ? "solve-start" as const : "whole-solve-gyro" as const;
  const matching = bottom ? competing.find((candidate) => candidate.face === bottom) : undefined;
  const best = matching ?? leader;
  const issues: CfopAnalysisIssue[] = [];
  if (best.collapsed) issues.push({ code: "incoherent-cfop-progression" });
  if (bottom && !matching) {
    issues.push({ code: "cross-face-conflict", observed: bottom, inferred: best.face, source });
  } else if (!bottom && competing.length > 1) {
    issues.push({ code: "ambiguous-cross", candidates: competing.map((candidate) => candidate.face) });
  }

  const { face, f2lIdx } = best;
  const slotDefs = f2lSlotsForCrossFace(face);
  const crossSolved = (s: StateFlags) => EDGES_OF_FACE[face].every((e) => s.edgeSolved[e]);
  const isSlotSolved = (s: StateFlags, d: (typeof slotDefs)[number]) =>
    s.cornerSolved[d.corner] && s.edgeSolved[d.edge];

  const crossIdx = firstHeld(states, 0, f2lIdx, crossSolved, CROSS_DIP);

  // Each pair is dated by when it went in for good, so a pair knocked out and rebuilt
  // is credited to the rebuild, and a neighbour briefly disturbed by an insertion keeps
  // its own time. The steps are the pairs in the order those times fall.
  const dated = slotDefs
    .map((d, order) => ({
      name: d.name,
      order,
      at: Math.max(crossIdx, firstHeld(states, 0, f2lIdx, (s) => isSlotSolved(s, d), SLOT_DIP)),
    }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const slotCuts = dated.map((slot) => slot.at);
  // A slot can only be filled once; a name that comes round again is not a real slot.
  const slotNames: (string | null)[] = dated.map((slot, i) =>
    dated.slice(0, i).some((earlier) => earlier.name === slot.name) ? null : slot.name);

  const llFaceIndex = FACES.indexOf(OPPOSITE[face]);
  const f2lIntact = (s: StateFlags) => crossSolved(s) && slotDefs.every((d) => isSlotSolved(s, d));
  const ollIdx = firstFrom(states, f2lIdx, (s) => s.faceUniform[llFaceIndex] && f2lIntact(s));
  const cuts = [crossIdx, ...slotCuts, ollIdx === -1 || ollIdx > endIdx ? endIdx : ollIdx, endIdx];

  // A pair dated to the same move as the step before it went in with that step's moves.
  const solvedDuring: (StepName | undefined)[] = STEP_NAMES.map(() => undefined);
  for (let k = 1; k <= 4; k++) {
    if (cuts[k] === cuts[k - 1]) solvedDuring[k] = solvedDuring[k - 1] ?? STEP_NAMES[k - 1];
  }
  // Nothing to report for a cross that was never needed or a pair with no cross moves.
  if (cuts[0] === 0) for (let k = 1; k <= 4; k++) if (solvedDuring[k] === "Cross") solvedDuring[k] = undefined;

  return { crossFace: face, cuts, slots: slotNames, solvedDuring, issues };
}

/**
 * Let a pair's step run to the end of the algorithm it was part of.
 *
 * Some F2L algorithms have the pair in its slot before they finish — `R' F R F'` drops
 * it in with the `R'` and the `F R F'` only reshuffles the last layer. The state says
 * the pair was done at the `R'`; the solver was still executing. When the turns from
 * inside the step to some point before the next step ends are a catalogue F2L
 * algorithm, and the pairs and cross are still in at that point, the step ends there.
 */
const EXTENSION_LIMIT = 4;

function extendToAlgorithms(
  { crossFace, cuts, slots }: Boundaries,
  states: StateFlags[],
  tokens: readonly string[],
): number[] {
  const adjusted = [...cuts];
  const slotDefs = f2lSlotsForCrossFace(crossFace);
  const inPlace = (s: StateFlags, count: number) =>
    EDGES_OF_FACE[crossFace].every((e) => s.edgeSolved[e]) &&
    slots.slice(0, count).every((name) => {
      const d = slotDefs.find((slot) => slot.name === name);
      return !d || (s.cornerSolved[d.corner] && s.edgeSolved[d.edge]);
    });
  for (let k = 1; k <= 4; k++) {
    const from = adjusted[k - 1];
    const to = adjusted[k];
    if (to <= from) continue;
    // Only a short tail, and only one that does not cancel into the step: `R'` and a
    // Sune that starts with `R` are not one algorithm.
    const lastFamily = parseMove(tokens[to - 1])?.family;
    const nextFamily = parseMove(tokens[to] ?? "")?.family;
    if (lastFamily === nextFamily) continue;
    // The tail has to be working on this pair still, as `F R F'` is: turns that never
    // touch it are the next step's.
    const own = slotDefs.find((slot) => slot.name === slots[k - 1]);
    const disturbs = (j: number) => !!own && !(states[j].cornerSolved[own.corner] && states[j].edgeSolved[own.edge]);
    search: for (let end = Math.min(adjusted[k + 1], to + EXTENSION_LIMIT); end > to; end--) {
      if (!inPlace(states[end], k)) continue;
      let touched = false;
      for (let j = to + 1; j < end; j++) touched ||= disturbs(j);
      if (!touched) continue;
      for (let start = from; start < to; start++) {
        if (lookupAlgorithm(tokens.slice(start, end), "F2L")) {
          adjusted[k] = end;
          break search;
        }
      }
    }
  }
  return adjusted;
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
