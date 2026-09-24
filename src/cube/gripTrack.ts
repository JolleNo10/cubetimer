/**
 * Working out how the cube was held for every move of a solve, after the fact.
 *
 * Reading the gyroscope one move at a time and believing whatever it says does not
 * work. Hands move while they turn, so a reading taken the instant a move lands is
 * often caught halfway between two grips, and a solve annotated that way is full of
 * rotations that were never done — a `y` and a `y'` a move apart, cancelling out.
 *
 * Two things rule those out here. The first is that the whole solve is solved at once
 * rather than a move at a time: every move's reading is weighed against the cost of
 * having turned the cube to get there, and the best explanation of the solve as a
 * whole wins. The second is that the cost of a rotation depends on how long the solver
 * had to make it. Turning the cube takes time. A rotation across a pause is cheap; one
 * between two turns a few milliseconds apart is nearly free evidence of nothing, and is
 * priced accordingly.
 *
 * What comes out is one orientation per move, which is what lets the move stream be
 * rewritten as the solver would have written it.
 */
import {
  ALL_ORIENTATIONS,
  IDENTITY,
  describeGrip,
  gripFromDescription,
  reorientMove,
  rotationTokensBetween,
  type Orientation,
} from "./orientation";
import { facesAtPositions, scoreAll, snapOrientation } from "./gyroGrip";
import type { TimedMove } from "./notation";
import type { Face } from "./moves";
import type { Quat } from "../util/quat";

/**
 * How the tracker weighs one explanation of a solve against another.
 *
 * Exported so they can be tried against a real trace rather than argued about.
 */
export const GRIP_WEIGHTS = {
  /** Cost of a quarter turn of rotation, before the time it had to happen in. */
  rotation: 0.5,
  /**
   * A rotation is priced as though it took this long. Turns that follow each other
   * faster than this leave no room for one, and the cost rises in proportion.
   */
  regripMs: 120,
  /** Ceiling on that multiplier, so two turns in the same millisecond stay finite. */
  maxRegripFactor: 12,
  /**
   * Cost per move of holding the cube with the cross face anywhere but the bottom.
   * It happens — an M slice takes the centres with it — but it is never the likelier
   * reading of a wobble.
   */
  offCross: 0.6,
  /**
   * An excursion that returns to the grip it left, and was over faster than the cube
   * could physically have been turned out and back, did not happen.
   */
  minExcursionMs: 250,
} as const;

export type GripTrackInput = {
  moves: readonly TimedMove[];
  /** One entry per move, in step with `moves`. */
  readings: readonly (Quat | null)[];
  /** The pose the cube was scrambled in: white on top, green in front. */
  reference: Quat;
  /**
   * The face that spends the solve underneath — the one the cross was built on.
   *
   * Worked out from the readings when it is not given, which is usually better than
   * being told: the question the tracker is really asking is which face the solver
   * kept down, and that is a thing the gyroscope saw directly.
   */
  crossFace?: Face;
};

/**
 * How the cube was held, move by move — everything needed to write a solve out as the
 * solver turned it.
 */
export type SolveGrip = {
  /** How the cube was held for each move, in step with the move stream. */
  orientations: readonly Orientation[];
  /** The turn made during inspection, before the first move, e.g. `["z2", "y"]`. */
  inspection: readonly string[];
};

export type GripTrack = SolveGrip & {
  /** 0 when the readings settled nothing, 1 when every move was unambiguous. */
  confidence: number;
  warnings: string[];
};

/**
 * Which face the solver kept underneath, by asking every reading and counting.
 *
 * A vote rather than a glance: individual readings wobble, but a solve is dozens of
 * them and the cross face is down for nearly all of it.
 */
function steadiestBottom(
  readings: readonly (Quat | null)[],
  reference: Quat,
): Face {
  const tally = new Map<Face, number>();
  for (const pose of readings) {
    if (!pose) continue;
    const bottom = facesAtPositions(snapOrientation(pose, reference).orientation).D;
    tally.set(bottom, (tally.get(bottom) ?? 0) + 1);
  }
  let best: Face = "D";
  let bestCount = -1;
  for (const [face, count] of tally) {
    if (count > bestCount) {
      bestCount = count;
      best = face;
    }
  }
  return best;
}

/** How many quarter turns of rotation separate two grips. */
function turnsBetween(from: Orientation, to: Orientation): number {
  let turns = 0;
  for (const token of rotationTokensBetween(from, to)) {
    turns += token.endsWith("2") ? 2 : 1;
  }
  return turns;
}

const TURN_COSTS: number[][] = ALL_ORIENTATIONS.map((from) =>
  ALL_ORIENTATIONS.map((to) => turnsBetween(from.orientation, to.orientation)),
);

/**
 * How dearly a rotation is priced, given how long there was to make it.
 *
 * Longer than a regrip takes and it is priced plainly; shorter and it climbs, because
 * the turns either side of it leave no room for the cube to have moved.
 */
function regripFactor(gapMs: number): number {
  if (gapMs >= GRIP_WEIGHTS.regripMs) return 1;
  return Math.min(
    GRIP_WEIGHTS.maxRegripFactor,
    GRIP_WEIGHTS.regripMs / Math.max(gapMs, 1),
  );
}

/**
 * The likeliest way the cube was held through a solve.
 *
 * A Viterbi pass over the twenty-four grips: every move contributes how well each grip
 * matches the gyroscope, every step between moves contributes what it would have cost
 * to turn the cube, and the cheapest path through the whole solve is the answer.
 */
export function trackGrip(input: GripTrackInput): GripTrack {
  const { moves, readings, reference } = input;
  const states = ALL_ORIENTATIONS.length;
  const warnings: string[] = [];

  if (moves.length === 0) {
    return { orientations: [], inspection: [], confidence: 0, warnings };
  }
  const crossFace = input.crossFace ?? steadiestBottom(readings, reference);

  // Emission costs: how badly each grip fits the reading taken at each move.
  const emission: number[][] = moves.map((_, i) => {
    const pose = readings[i] ?? null;
    const scores = pose ? scoreAll(pose, reference) : null;
    return ALL_ORIENTATIONS.map((candidate, s) => {
      const fit = scores ? 1 - scores[s] : 0;
      const offCross =
        candidate.orientation[crossFace] === "D" ? 0 : GRIP_WEIGHTS.offCross;
      return fit + offCross;
    });
  });

  const cost = emission[0].slice();
  const from: number[][] = [];

  for (let i = 1; i < moves.length; i++) {
    const gap = Math.max(0, moves[i].t - moves[i - 1].t);
    const factor = regripFactor(gap) * GRIP_WEIGHTS.rotation;
    const next = new Array<number>(states).fill(Number.POSITIVE_INFINITY);
    const back = new Array<number>(states).fill(0);
    for (let to = 0; to < states; to++) {
      for (let prev = 0; prev < states; prev++) {
        const total = cost[prev] + TURN_COSTS[prev][to] * factor;
        if (total < next[to]) {
          next[to] = total;
          back[to] = prev;
        }
      }
      next[to] += emission[i][to];
    }
    from.push(back);
    for (let s = 0; s < states; s++) cost[s] = next[s];
  }

  // Walk the cheapest path back to the first move.
  let best = 0;
  for (let s = 1; s < states; s++) if (cost[s] < cost[best]) best = s;
  const path = new Array<number>(moves.length);
  path[moves.length - 1] = best;
  for (let i = moves.length - 1; i > 0; i--) path[i - 1] = from[i - 1][path[i]];

  let orientations = path.map((s) => ALL_ORIENTATIONS[s].orientation);
  orientations = dropBriefExcursions(orientations, moves, warnings);

  const offCross = orientations.filter((o) => o[crossFace] !== "D").length;
  if (offCross > 0) {
    warnings.push(
      `${crossFace} left the bottom for ${offCross} of ${moves.length} moves`,
    );
  }

  return {
    orientations,
    inspection: rotationTokensBetween(IDENTITY, orientations[0]),
    confidence: confidenceOf(emission, path),
    warnings,
  };
}

/**
 * Throw away rotations that the solver had no time to make.
 *
 * The path is already priced to avoid these, but a gyroscope that reads the same wrong
 * grip for several moves running can still buy one. The test is physical rather than
 * statistical: the cube left a grip and came back to it faster than two turns of the
 * wrist, so it never left.
 */
function dropBriefExcursions(
  orientations: readonly Orientation[],
  moves: readonly TimedMove[],
  warnings: string[],
): Orientation[] {
  const result = [...orientations];
  let start = 0;
  while (start < result.length) {
    let end = start;
    while (end + 1 < result.length && result[end + 1] === result[start]) end++;

    const before = start > 0 ? result[start - 1] : null;
    const after = end + 1 < result.length ? result[end + 1] : null;
    const isExcursion = before !== null && before === after && before !== result[start];
    if (isExcursion) {
      const span = moves[Math.min(end + 1, moves.length - 1)].t - moves[start - 1].t;
      if (span < GRIP_WEIGHTS.minExcursionMs) {
        for (let i = start; i <= end; i++) result[i] = before;
        warnings.push(
          `ignored a ${end - start + 1}-move turn away and back at move ${start} (${Math.round(span)}ms)`,
        );
        // The run just merged into its neighbours, so look again from there.
        start = 0;
        continue;
      }
    }
    start = end + 1;
  }
  return result;
}

/**
 * The widest a reading can separate two grips.
 *
 * Neighbouring grips are a quarter turn apart and score 0.5 against each other, so a
 * perfect reading beats its nearest rival by exactly that much and no more.
 */
const CLEAREST_READING = 0.5;

/**
 * How clearly the readings picked one grip over the rest, averaged over the solve.
 *
 * 1 means every move's reading landed squarely on one grip; 0 means they were all
 * balanced between two and the answer came from the timing alone.
 */
function confidenceOf(emission: readonly number[][], path: readonly number[]): number {
  if (emission.length === 0) return 0;
  let total = 0;
  for (const [i, row] of emission.entries()) {
    const chosen = row[path[i]];
    let runnerUp = Number.POSITIVE_INFINITY;
    for (const [s, value] of row.entries()) {
      if (s !== path[i] && value < runnerUp) runnerUp = value;
    }
    total += Math.max(0, Math.min(1, (runnerUp - chosen) / CLEAREST_READING));
  }
  return total / emission.length;
}

/**
 * Write the solve out as the solver did it, rotations and all.
 *
 * Wherever the grip changes, the rotation that changed it goes in before the move, and
 * every turn is named for the face it was from where the solver was sitting.
 */
export function rewriteWithRotations(
  moves: readonly TimedMove[],
  orientations: readonly Orientation[],
  /**
   * The grip the cube was already in. Steps are written out one at a time, so a
   * rotation made between the last move of one and the first of the next belongs to
   * the step it starts, and would otherwise go unwritten.
   */
  heldBefore: Orientation | null = null,
): TimedMove[] {
  const out: TimedMove[] = [];
  let held: Orientation | null = heldBefore;
  for (const [i, { move, t }] of moves.entries()) {
    const orientation: Orientation = orientations[i] ?? held ?? IDENTITY;
    if (held && orientation !== held) {
      for (const token of rotationTokensBetween(held, orientation)) {
        out.push({ move: token, t });
      }
    }
    held = orientation;
    out.push({ move: reorientMove(move, orientation), t });
  }
  return out;
}

/**
 * Write a track down small enough to keep with the solve.
 *
 * The readings themselves are not worth storing — thousands of quaternions whose only
 * purpose was to produce this — but what they were taken to mean has to survive, or a
 * rebuilt breakdown would silently lose every rotation the solver made.
 *
 * Two letters per move, the faces at the bottom and the back, after the turn made
 * during inspection. `z2 y|UBUBUR` and so on.
 */
export function encodeGripTrack(track: GripTrack): string {
  return `${track.inspection.join(" ")}|${track.orientations.map(describeGrip).join("")}`;
}

/** Read one back. `null` for anything that is not one. */
export function decodeGripTrack(encoded: string): SolveGrip | null {
  const split = encoded.indexOf("|");
  if (split < 0) return null;
  const codes = encoded.slice(split + 1);
  if (codes.length % 2 !== 0) return null;
  const orientations: Orientation[] = [];
  for (let i = 0; i < codes.length; i += 2) {
    const orientation = gripFromDescription(codes.slice(i, i + 2));
    if (!orientation) return null;
    orientations.push(orientation);
  }
  const inspection = encoded.slice(0, split).split(" ").filter(Boolean);
  return { orientations, inspection };
}
