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

/** A move as recorded during a solve, timed from the moment the timer started. */
export type TimedMove = {
  move: string;
  /** Milliseconds since the start of the solve. */
  t: number;
};

export type PhaseName =
  | "Cross"
  | "F2L #1"
  | "F2L #2"
  | "F2L #3"
  | "F2L #4"
  | "OLL"
  | "PLL";

export type Phase = {
  name: PhaseName;
  /** Index of the first move of this phase in the solve's move list. */
  fromMove: number;
  /** Index one past the last move of this phase. */
  toMove: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  moveCount: number;
  /** Idle time before the first move of the phase — i.e. looking at the cube. */
  recognitionMs: number;
  /** Time actually spent turning. */
  executionMs: number;
  tps: number;
  /** Which F2L slot was finished, for F2L phases. */
  detail?: string;
};

export type SolveAnalysis = {
  crossFace: Face;
  phases: Phase[];
  moveCount: number;
  durationMs: number;
  tps: number;
  /** Gaps between consecutive moves longer than `PAUSE_THRESHOLD_MS`. */
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
 * Break a solve down into CFOP phases.
 *
 * Everything is measured in the cube's own frame of reference — cube rotations are not
 * reported over Bluetooth and do not change the state — so this works no matter which
 * colour the solver crosses on or how the cube is held. Returns `null` for solves that
 * do not end solved, or that have no moves.
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
  if (!states[states.length - 1].solved) return null;

  // Try every face as the cross face and keep the one whose first two layers finish
  // earliest. This makes the analysis independent of colour neutrality and of how the
  // solver happened to be holding the cube.
  let best: {
    face: Face;
    crossIdx: number;
    f2lIdx: number;
    slots: { corner: number; edge: number; name: string; idx: number }[];
  } | null = null;

  for (const face of FACES) {
    const slotDefs = f2lSlotsForCrossFace(face);
    const crossSolved = (s: StateFlags) =>
      EDGES_OF_FACE[face].every((e) => s.edgeSolved[e]);
    const f2lIdx = firstFrom(
      states,
      0,
      (s) =>
        crossSolved(s) &&
        slotDefs.every((d) => s.cornerSolved[d.corner] && s.edgeSolved[d.edge]),
    );
    if (f2lIdx === -1) continue;
    // The cross is dated by when it first comes together: F2L triggers on the F, B and
    // L faces routinely disturb a cross edge and put it straight back.
    const crossIdx = Math.min(firstFrom(states, 0, crossSolved), f2lIdx);
    // Pairs are dated by the moment the number of finished slots goes up, rather than
    // by each slot individually: inserting one pair frequently disturbs a neighbouring
    // slot for a few moves, and that must not push the earlier pair's time forward.
    const isSlotSolved = (s: StateFlags, d: (typeof slotDefs)[number]) =>
      s.cornerSolved[d.corner] && s.edgeSolved[d.edge];
    const slots: { corner: number; edge: number; name: string; idx: number }[] = [];
    const credited = new Set<string>();
    let prev = crossIdx;
    for (let k = 1; k <= 4; k++) {
      const idx = firstFrom(
        states,
        prev,
        (st) => slotDefs.filter((d) => isSlotSolved(st, d)).length >= k,
      );
      if (idx === -1) break;
      const justFinished =
        slotDefs.find(
          (d) =>
            !credited.has(d.name) &&
            isSlotSolved(states[idx], d) &&
            (idx === 0 || !isSlotSolved(states[idx - 1], d)),
        ) ??
        slotDefs.find(
          (d) => !credited.has(d.name) && isSlotSolved(states[idx], d),
        );
      if (!justFinished) break;
      credited.add(justFinished.name);
      slots.push({ ...justFinished, idx });
      prev = idx;
    }
    if (slots.length < 4) continue;
    if (
      best === null ||
      f2lIdx < best.f2lIdx ||
      (f2lIdx === best.f2lIdx && crossIdx < best.crossIdx)
    ) {
      best = { face, crossIdx, f2lIdx, slots };
    }
  }
  if (!best) return null;

  const crossFace = best.face;
  const lastLayer = OPPOSITE[crossFace];
  const llFaceIndex = FACES.indexOf(lastLayer);
  const ollIdx = firstFrom(states, best.f2lIdx, (s) => s.faceUniform[llFaceIndex]);
  const endIdx = moves.length;

  const boundaries: { name: PhaseName; at: number; detail?: string }[] = [
    { name: "Cross", at: best.crossIdx },
    { name: "F2L #1", at: best.slots[0].idx, detail: best.slots[0].name },
    { name: "F2L #2", at: best.slots[1].idx, detail: best.slots[1].name },
    { name: "F2L #3", at: best.slots[2].idx, detail: best.slots[2].name },
    { name: "F2L #4", at: best.slots[3].idx, detail: best.slots[3].name },
    { name: "OLL", at: ollIdx === -1 ? endIdx : ollIdx },
    { name: "PLL", at: endIdx },
  ];

  const phases: Phase[] = [];
  let from = 0;
  let startMs = 0;
  for (const boundary of boundaries) {
    const to = Math.max(from, Math.min(boundary.at, endIdx));
    const endMs = to === 0 ? 0 : moves[to - 1].t;
    const firstMoveMs = to > from ? moves[from].t : endMs;
    const recognitionMs = Math.max(
      0,
      firstMoveMs - startMs - moveDuration(moves, from),
    );
    const durationMs = Math.max(0, endMs - startMs);
    phases.push({
      name: boundary.name,
      detail: boundary.detail,
      fromMove: from,
      toMove: to,
      startMs,
      endMs,
      durationMs,
      moveCount: to - from,
      recognitionMs,
      executionMs: Math.max(0, durationMs - recognitionMs),
      tps: durationMs > 0 ? ((to - from) / durationMs) * 1000 : 0,
    });
    from = to;
    startMs = endMs;
  }

  const durationMs = moves[moves.length - 1].t;
  const pauses: SolveAnalysis["pauses"] = [];
  for (let i = 1; i < moves.length; i++) {
    const gap = moves[i].t - moves[i - 1].t;
    if (gap >= PAUSE_THRESHOLD_MS) {
      pauses.push({ afterMove: i - 1, startMs: moves[i - 1].t, durationMs: gap });
    }
  }

  return {
    crossFace,
    phases,
    moveCount: moves.length,
    durationMs,
    tps: durationMs > 0 ? (moves.length / durationMs) * 1000 : 0,
    pauses,
  };
}

/**
 * Rough time attributable to the turn itself rather than to looking at the cube.
 * Timestamps mark move completion, so the first move of a phase always overlaps the
 * previous phase a little; subtracting a typical turn keeps recognition from inflating.
 */
function moveDuration(moves: TimedMove[], index: number): number {
  if (index <= 0 || index >= moves.length) return 0;
  return Math.min(120, moves[index].t - moves[index - 1].t);
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
