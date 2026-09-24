/**
 * Reading the cube's orientation in the solver's hands off the gyroscope.
 *
 * The cube reports its turns relative to its own centres, so `R` is the red layer
 * however the cube is being held, and whole-cube rotations are never reported at all.
 * That leaves the solve unreadable on its own: `R U R'` written by a solver who had
 * turned the cube a quarter of the way round is a different three moves. The gyroscope
 * is the only thing that can say which way round they were, and this is where its
 * quaternions become faces.
 *
 * Everything here is measured against a reference pose rather than against the
 * gyroscope's own frame, which has no fixed meaning and drifts. The reference is the
 * cube held white on top and green in front — the orientation scrambles are applied in
 * — so the rotation away from it *is* the `Orientation` the rest of the cube code
 * already speaks.
 */
import { multiply, normalize, relative, toMatrix, type Quat } from "../util/quat";
import {
  ALL_ORIENTATIONS,
  type Orientation,
  type Rotation,
} from "./orientation";
import { FACES, type Face } from "./moves";

/**
 * Which way each face points in the cube's own frame.
 *
 * `gan-web-bluetooth` documents the quaternion as right-handed with +X through red, +Y
 * through blue and +Z through white, which in the standard colour scheme is `R`, `B`
 * and `U`. The remaining three are their opposites.
 */
export const FACE_AXES: Record<Face, readonly [number, number, number]> = {
  R: [1, 0, 0],
  L: [-1, 0, 0],
  B: [0, 1, 0],
  F: [0, -1, 0],
  U: [0, 0, 1],
  D: [0, 0, -1],
};

/**
 * An orientation as a rotation matrix, row-major.
 *
 * The matrix sends each face's own axis to the axis of the position that face ends up
 * in, so its columns are the images of the three body axes — red, blue and white.
 */
function matrixFor(orientation: Orientation): number[] {
  const [cx, cy, cz] = [
    FACE_AXES[orientation.R],
    FACE_AXES[orientation.B],
    FACE_AXES[orientation.U],
  ];
  return [
    cx[0], cy[0], cz[0],
    cx[1], cy[1], cz[1],
    cx[2], cy[2], cz[2],
  ];
}

function aboutAxis(axis: readonly [number, number, number], radians: number): Quat {
  const s = Math.sin(radians / 2);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(radians / 2) };
}

/**
 * The three whole-cube rotations as quaternions.
 *
 * `x` turns the way `R` does, `y` the way `U` does and `z` the way `F` does — and a
 * face turn is clockwise as you look at that face, which is a *negative* turn about
 * the axis pointing out of it under the right-hand rule. Hence the minus.
 */
const TURN_QUATS: Record<"x" | "y" | "z", Quat> = {
  x: aboutAxis(FACE_AXES.R, -Math.PI / 2),
  y: aboutAxis(FACE_AXES.U, -Math.PI / 2),
  z: aboutAxis(FACE_AXES.F, -Math.PI / 2),
};

/** The pose reached from the reference by a sequence of whole-cube rotations. */
export function quatForTokens(tokens: readonly string[]): Quat {
  let pose: Quat = { x: 0, y: 0, z: 0, w: 1 };
  for (const token of tokens) {
    const axis = token[0] as "x" | "y" | "z";
    const amount = token.endsWith("'") ? 3 : token.endsWith("2") ? 2 : 1;
    // Each turn acts in the frame already reached, so it goes on the left.
    for (let i = 0; i < amount; i++) pose = multiply(TURN_QUATS[axis], pose);
  }
  return normalize(pose);
}

const CANDIDATES: readonly {
  rotation: Rotation;
  matrix: number[];
  quat: Quat;
}[] = ALL_ORIENTATIONS.map((rotation) => ({
  rotation,
  matrix: matrixFor(rotation.orientation),
  quat: quatForTokens(rotation.tokens),
}));

/** The pose each of the twenty-four grips corresponds to, in `ALL_ORIENTATIONS` order. */
export const ORIENTATION_QUATS: readonly Quat[] = CANDIDATES.map((c) => c.quat);

/**
 * How alike two rotation matrices are, on a scale where 1 is identical and 0 is a half
 * turn away.
 *
 * The Frobenius inner product of two rotation matrices is `1 + 2cos θ`, so this works
 * out as `(1 + cos θ) / 2` — the angle between them, read off without the arc cosine.
 * Two grips a quarter turn apart therefore score 0.5, which is as close as two
 * different ways of holding a cube ever get.
 */
function similarity(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += a[i] * b[i];
  return (sum + 1) / 4;
}

/**
 * Score all twenty-four grips, in `ALL_ORIENTATIONS` order.
 *
 * The sorted form below is for reading; this one is for the tracker, which walks the
 * same twenty-four every move and wants them where it left them.
 */
export function scoreAll(measured: Quat, reference: Quat): number[] {
  const matrix = toMatrix(relative(reference, measured));
  return CANDIDATES.map(({ matrix: candidate }) => similarity(matrix, candidate));
}

export type OrientationScore = {
  rotation: Rotation;
  /** 1 when the cube is exactly here, falling to 0 half a turn away. */
  score: number;
};

/**
 * Score every one of the twenty-four ways the cube could be being held.
 *
 * The tracker needs all of them, not just the best: a reading halfway between two
 * orientations is a real thing that happens every time the solver's hands move, and
 * what settles it is the moves either side, not the quaternion.
 */
export function orientationScores(
  measured: Quat,
  reference: Quat,
): OrientationScore[] {
  const matrix = toMatrix(relative(reference, measured));
  return CANDIDATES.map(({ rotation, matrix: candidate }) => ({
    rotation,
    score: similarity(matrix, candidate),
  })).sort((a, b) => b.score - a.score);
}

export type Snapped = {
  orientation: Orientation;
  /** The rotations that reach it from the reference pose, e.g. `["z2", "y"]`. */
  tokens: readonly string[];
  /** 1 when the cube is exactly here, falling to 0 half a turn away. */
  score: number;
  /** How far clear of the runner-up. Near zero means the reading settles nothing. */
  margin: number;
};

/**
 * The way the cube is most likely being held, and how sure that is.
 *
 * Kept to a single pass with no sorting or intermediate objects: the cube reports its
 * pose tens of times a second, and every one of those readings comes through here.
 */
export function snapOrientation(measured: Quat, reference: Quat): Snapped {
  const matrix = toMatrix(relative(reference, measured));
  let best = CANDIDATES[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let nextScore = Number.NEGATIVE_INFINITY;
  for (const candidate of CANDIDATES) {
    const score = similarity(matrix, candidate.matrix);
    if (score > bestScore) {
      nextScore = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > nextScore) {
      nextScore = score;
    }
  }
  return {
    orientation: best.rotation.orientation,
    tokens: best.rotation.tokens,
    score: bestScore,
    margin: bestScore - nextScore,
  };
}

/** The angle between two orientations of the cube, in degrees. */
export function angleBetween(a: Quat, b: Quat): number {
  const { w } = relative(a, b);
  return (2 * Math.acos(Math.min(1, Math.abs(w))) * 180) / Math.PI;
}

/**
 * Restrict a reading to the four ways of holding the cube with one face underneath.
 *
 * Through most of a solve the cross face is on the bottom and the only open question is
 * which way the cube is facing, so asking the narrower question gives a far better
 * answer than snapping freely and hoping it lands the right way up.
 */
export function snapWithBottom(
  measured: Quat,
  reference: Quat,
  bottom: Face,
): Snapped {
  const scores = orientationScores(measured, reference).filter(
    ({ rotation }) => rotation.orientation[bottom] === "D",
  );
  const [best, next] = scores;
  return {
    orientation: best.rotation.orientation,
    tokens: best.rotation.tokens,
    score: best.score,
    margin: best.score - (next?.score ?? 0),
  };
}

/** Which face of the cube is at each position, for printing a reading out. */
export function facesAtPositions(orientation: Orientation): Record<Face, Face> {
  return Object.fromEntries(
    FACES.map((position) => [
      position,
      FACES.find((face) => orientation[face] === position) ?? position,
    ]),
  ) as Record<Face, Face>;
}
