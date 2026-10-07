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
import { recognizeF2lSlot } from "./f2l";
import { F2L_POSITIONS } from "./f2lCases";

export type { TimedMove };

/**
 * What the analysis records, as a version. Stored analyses older than this are rebuilt
 * from the solve's raw facts when those facts are still there.
 *
 * 2: F2L steps carry the catalogue case they started from.
 * 3: Canonical CFOP checkpoints and explicit evidence-based quality.
 * 4: Complete candidate coherence and independent gyro evidence.
 * 5: Identity-preserving F2L milestones and independent physical-source conflicts.
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
};

export type CfopAnalysisIssue =
  | { code: "bottom-evidence-conflict"; observedStart: Face; tracked: Face }
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

  const { crossFace, cuts, slots, issues } = boundaries;
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

  /**
   * Which of the 41 cases a pair started as. A pair that was already solved (and then
   * broken and rebuilt) or was buried in another slot is not one of them.
   */
  const f2lCase = (facing: KPattern, slot: string): string | null => {
    const position = F2L_POSITIONS.find(
      (candidate) => slotInCubeFrame(rotation.orientation, candidate) === slot,
    );
    if (!position) return null;
    const recognition = recognizeF2lSlot(scrambledState.kpuzzle, facing, position);
    return recognition.status === "case" ? (recognition.match?.name ?? null) : null;
  };

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
    const recognitionMs =
      index === 0 ? 0 : recognitionTime(turning, previousCumulative, timeMs);
    const metrics = countTurns(recorded.map((m) => m.move));
    // A case is whatever the solver was looking at when the step began.
    const slot = index >= 1 && index <= 4 ? (slots[index - 1] ?? null) : null;
    const insertion = slot && to > from
      ? grip
        ? { insertedAt: middleLayerSlot(slotInHeldFrame(grip.orientations[to - 1] ?? grip.orientations[0], slot)), insertedAtSource: "grip" as const }
        : { insertedAt: inferInsertionPosition(slotInHeldFrame(rotation.orientation, slot), reorientMoves(turned, rotation.orientation).map((m) => m.move)), insertedAtSource: "inferred" as const }
      : {};
    const caseName =
      name === "OLL"
        ? boundaries.ollCase
        : name === "PLL"
          ? boundaries.pllCase
          : slot
            ? f2lCase(stateFacing(from), slot)
            : null;
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

type CfopCandidate = {
  crossFace: Face;
  cuts: number[];
  slots: (string | null)[];
  crossIdx: number;
  f2lIdx: number;
  ollIdx: number;
  endIdx: number;
  ollCase: string | null;
  pllCase: string | null;
  unassignedSlots: number;
  unrecognizedLastLayer: number;
  /** No independent phase progression or prepared pairs before the last-layer state appeared. */
  collapsedProgression: boolean;
};

/** Canonical checkpoints require the accumulated CFOP invariants, not transient pair counts. */
function candidateForFace(states: StateFlags[], patterns: KPattern[], endIdx: number, face: Face): CfopCandidate | null {
  const slotDefs = f2lSlotsForCrossFace(face);
  const crossSolved = (state: StateFlags) => EDGES_OF_FACE[face].every(edge => state.edgeSolved[edge]);
  const isSlotSolved = (state: StateFlags, slot: (typeof slotDefs)[number]) => state.cornerSolved[slot.corner] && state.edgeSolved[slot.edge];
  const fullF2l = (state: StateFlags) => crossSolved(state) && slotDefs.every(slot => isSlotSolved(state, slot));
  const f2lIdx = firstFrom(states, 0, fullF2l);
  if (f2lIdx === -1 || f2lIdx > endIdx) return null;
  // Temporary Cross/pair disruption between milestones is permitted.
  const crossIdx = firstFrom(states, 0, crossSolved);
  const slotCuts: number[] = [];
  const slotNames: (string | null)[] = [];
  const filled = new Set<string>();
  let previous = crossIdx;
  for (let k = 1; k <= 4; k++) {
    // Earlier pair identities must be restored before another completion is credited.
    const idx = firstFrom(states, previous, state => crossSolved(state)
      && slotDefs.filter(slot => filled.has(slot.name)).every(slot => isSlotSolved(state, slot))
      && slotDefs.filter(slot => isSlotSolved(state, slot)).length >= k);
    if (idx === -1 || idx > endIdx) return null;
    const justFilled = slotDefs.find(slot => !filled.has(slot.name) && isSlotSolved(states[idx], slot)
      && (idx === 0 || !isSlotSolved(states[idx - 1], slot)))
      ?? slotDefs.find(slot => !filled.has(slot.name) && isSlotSolved(states[idx], slot));
    if (justFilled) filled.add(justFilled.name);
    slotCuts.push(idx);
    slotNames.push(justFilled?.name ?? null);
    previous = idx;
  }
  const llFaceIndex = FACES.indexOf(OPPOSITE[face]);
  const ollIdx = firstFrom(states, f2lIdx, state => fullF2l(state) && state.faceUniform[llFaceIndex]);
  if (ollIdx === -1 || ollIdx > endIdx) return null;
  const rotation = new Alg(rotationForCrossFace(face).tokens.join(" "));
  const facing = (index: number) => reframe(patterns[0].kpuzzle, patterns[index], rotation);
  const ollCase = recogniseOll(patterns[0].kpuzzle, facing(f2lIdx));
  const pllCase = recognisePll(patterns[0].kpuzzle, facing(ollIdx));
  return {
    crossFace: face, crossIdx, f2lIdx, ollIdx, endIdx, slots: slotNames,
    cuts: [crossIdx, ...slotCuts, ollIdx, endIdx], ollCase, pllCase,
    unassignedSlots: slotNames.filter(slot => slot === null).length,
    unrecognizedLastLayer: Number(ollIdx > f2lIdx && ollCase === null) + Number(endIdx > ollIdx && pllCase === null),
    // Local/shared checkpoints and initial skips are fine. What lacks state support
    // is the entire Cross/F2L/OLL interpretation first appearing at one later state,
    // without initially solved pairs supporting a legitimate four-pair Cross skip.
    collapsedProgression: crossIdx > 0 && crossIdx === f2lIdx && f2lIdx === ollIdx
      && !slotDefs.every(slot => isSlotSolved(states[0], slot)),
  };
}

/** A complete interpretation must be no worse in structural/case evidence to dominate. */
function strongerCandidate(a: CfopCandidate, b: CfopCandidate): boolean {
  if (a.unassignedSlots > b.unassignedSlots || a.unrecognizedLastLayer > b.unrecognizedLastLayer) return false;
  const left = [...a.cuts, a.unassignedSlots, a.unrecognizedLastLayer, Number(a.collapsedProgression)];
  const right = [...b.cuts, b.unassignedSlots, b.unrecognizedLastLayer, Number(b.collapsedProgression)];
  return left.every((value, index) => value <= right[index]) && left.some((value, index) => value < right[index]);
}

/** State progression and physical evidence retain separate provenance. */
function findPhaseBoundaries(states: StateFlags[], patterns: KPattern[], endIdx: number, evidence: CfopAnalysisEvidence): (CfopCandidate & { issues: CfopAnalysisIssue[] }) | null {
  const candidates = FACES.flatMap(face => {
    const candidate = candidateForFace(states, patterns, endIdx, face);
    return candidate ? [candidate] : [];
  }).sort((a, b) => a.f2lIdx - b.f2lIdx || a.ollIdx - b.ollIdx || a.crossIdx - b.crossIdx);
  if (!candidates.length) return null;
  const progressive = candidates.filter(candidate => !candidate.collapsedProgression);
  const stateFrontier = progressive.filter(candidate => !progressive.some(other => strongerCandidate(other, candidate)));
  const physicalConflict = evidence.observedStartBottomFace !== undefined && evidence.trackedBottomFace !== undefined
    && evidence.observedStartBottomFace !== evidence.trackedBottomFace;
  const bottom = physicalConflict ? undefined : evidence.observedStartBottomFace ?? evidence.trackedBottomFace;
  const source = evidence.observedStartBottomFace ? "solve-start" : "whole-solve-gyro";
  const matching = stateFrontier.find(candidate => candidate.crossFace === bottom);
  const competing = stateFrontier;
  const selected = matching ?? competing[0] ?? candidates[0];
  const issues: CfopAnalysisIssue[] = [];
  if (physicalConflict) issues.push({ code: "bottom-evidence-conflict", observedStart: evidence.observedStartBottomFace!, tracked: evidence.trackedBottomFace! });
  if (selected.collapsedProgression) issues.push({ code: "incoherent-cfop-progression" });
  if (!matching && competing.length > 1) {
    issues.push({ code: "ambiguous-cross", candidates: competing.map(candidate => candidate.crossFace) });
  }
  if (bottom && selected.crossFace !== bottom) {
    issues.push({ code: "cross-face-conflict", observed: bottom, inferred: selected.crossFace, source });
  }
  return { ...selected, issues };
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
