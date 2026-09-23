/**
 * Re-expressing a solve in the frame the solver actually held the cube in.
 *
 * A smart cube reports turns relative to its own centres, so a solve done with white on
 * the bottom and one done with white on the left produce completely different move
 * streams for the same thing. Rotating the stream so the cross face is down makes solves
 * comparable, and it is what makes `U` mean "the last layer" — which the recognition
 * split and every OLL/PLL case lookup depend on.
 */
import { formatMove, parseMove, type MoveFamily, type TimedMove } from "./notation";
import { EDGE_NAMES, FACES, OPPOSITE, type Face } from "./moves";

/** Where each face ends up after the rotation, keyed by the face it started as. */
export type Orientation = Record<Face, Face>;

export const IDENTITY: Orientation = { U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" };

/** Single quarter-turn rotations, written as "the face here moves to there". */
export const GENERATORS: Record<"x" | "y" | "z", Orientation> = {
  // x turns the cube the way R does: F goes to U, U goes to B, and so on.
  x: { F: "U", U: "B", B: "D", D: "F", R: "R", L: "L" },
  // y turns the cube the way U does.
  y: { F: "L", L: "B", B: "R", R: "F", U: "U", D: "D" },
  // z turns the cube the way F does.
  z: { U: "R", R: "D", D: "L", L: "U", F: "F", B: "B" },
};

export function compose(first: Orientation, second: Orientation): Orientation {
  return Object.fromEntries(
    FACES.map((face) => [face, second[first[face]]]),
  ) as Orientation;
}

function repeat(orientation: Orientation, times: number): Orientation {
  let result = IDENTITY;
  for (let i = 0; i < times; i++) result = compose(result, orientation);
  return result;
}

export type Rotation = {
  /** Rotation tokens to write in front of the solve, e.g. `["z2"]`. Empty if none. */
  tokens: string[];
  orientation: Orientation;
};

const ROTATION_CHOICES: Rotation[] = (() => {
  const single: Rotation[] = [{ tokens: [], orientation: IDENTITY }];
  for (const axis of ["x", "y", "z"] as const) {
    for (const [amount, suffix] of [
      [1, ""],
      [2, "2"],
      [3, "'"],
    ] as const) {
      single.push({
        tokens: [`${axis}${suffix}`],
        orientation: repeat(GENERATORS[axis], amount),
      });
    }
  }
  // Two rotations reach every one of the 24 orientations; one is not enough.
  const all = [...single];
  for (const a of single.slice(1)) {
    for (const b of single.slice(1)) {
      all.push({
        tokens: [...a.tokens, ...b.tokens],
        orientation: compose(a.orientation, b.orientation),
      });
    }
  }
  return all;
})();

function orientationKey(orientation: Orientation): string {
  return FACES.map((face) => orientation[face]).join("");
}

/**
 * The twenty-four ways a cube can be held, each with the shortest rotations that reach
 * it.
 *
 * `ROTATION_CHOICES` lists ninety-one sequences because it enumerates pairs, and most
 * orientations are reachable several ways. Anything that has to reason over
 * orientations rather than over the rotations that produce them wants each one once.
 */
export const ALL_ORIENTATIONS: readonly Rotation[] = (() => {
  const best = new Map<string, Rotation>();
  for (const candidate of ROTATION_CHOICES) {
    const key = orientationKey(candidate.orientation);
    const existing = best.get(key);
    if (!existing || candidate.tokens.length < existing.tokens.length) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
})();

/** The orientation that undoes this one. */
export function invert(orientation: Orientation): Orientation {
  return Object.fromEntries(
    FACES.map((face) => [orientation[face], face]),
  ) as Orientation;
}

/**
 * The rotations that take a cube held one way to being held another.
 *
 * Written as the solver would do them: `from` is where their hands already are, so the
 * tokens are applied after it, in the frame they are looking at. Empty when the two are
 * the same.
 */
export function rotationTokensBetween(from: Orientation, to: Orientation): string[] {
  const needed = orientationKey(compose(invert(from), to));
  const match = ALL_ORIENTATIONS.find(
    (candidate) => orientationKey(candidate.orientation) === needed,
  );
  return match ? [...match.tokens] : [];
}

/**
 * Find the simplest way to hold the cube so `crossFace` is at the bottom.
 *
 * Four grips satisfy that, all equally valid — only the solver knows which they used.
 * The fewest rotations wins, then the one that keeps the front face where it is, since
 * a cuber flipping a cube over keeps looking at the same side.
 */
export function rotationForCrossFace(crossFace: Face): Rotation {
  let best: Rotation | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of ROTATION_CHOICES) {
    if (candidate.orientation[crossFace] !== "D") continue;
    const score =
      candidate.tokens.length * 100 +
      (candidate.orientation.F === "F" ? 0 : 10) +
      FACES.filter((face) => candidate.orientation[face] !== face).length;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best ?? { tokens: [], orientation: IDENTITY };
}

/**
 * Hold the cube with one colour underneath and another facing you.
 *
 * `null` when the two are the same face or opposite ones, since no grip puts those
 * where they were asked for.
 */
export function rotationForGrip(bottom: Face, front: Face): Rotation | null {
  if (bottom === front || OPPOSITE[bottom] === front) return null;
  let best: Rotation | null = null;
  for (const candidate of ROTATION_CHOICES) {
    if (
      candidate.orientation[bottom] !== "D" ||
      candidate.orientation[front] !== "F"
    ) {
      continue;
    }
    if (best === null || candidate.tokens.length < best.tokens.length) {
      best = candidate;
    }
  }
  return best;
}

/** The faces that can be at the front with `bottom` underneath. */
export function frontsFor(bottom: Face): Face[] {
  return FACES.filter((face) => face !== bottom && face !== OPPOSITE[bottom]);
}

/** Rewrite a move into the rotated frame. Non-face moves are passed through. */
export function reorientMove(move: string, orientation: Orientation): string {
  const parsed = parseMove(move);
  if (!parsed) return move;
  const mapped = orientation[parsed.family as Face] as MoveFamily | undefined;
  if (!mapped) return move;
  return formatMove({ family: mapped, amount: parsed.amount });
}

export function reorientMoves(
  moves: readonly TimedMove[],
  orientation: Orientation,
): TimedMove[] {
  return moves.map(({ move, t }) => ({
    move: reorientMove(move, orientation),
    t,
  }));
}

/** Which face of the scrambled cube is at a given position once it is held this way. */
export function faceAtPosition(orientation: Orientation, position: Face): Face {
  return FACES.find((face) => orientation[face] === position) ?? position;
}

/** Which faces of the scrambled cube end up underneath and facing the solver. */
export function gripFaces(orientation: Orientation): { bottom: Face; front: Face } {
  return {
    bottom: faceAtPosition(orientation, "D"),
    front: faceAtPosition(orientation, "F"),
  };
}

/**
 * Name a slot of the cube in the hand by the faces of the scrambled cube that meet
 * there.
 *
 * Everything worked out for a solver is worked out on a cube turned cross-face down,
 * where the slots are `FR`, `FL`, `BL` and `BR` by position. Those letters are not
 * faces: with white underneath the cube has been turned over, so the slot at the back
 * right holds blue and orange, not the blue and red that `BR` reads as. A slot has to
 * come back to the cube's own frame before it can be called by its colours.
 */
export function slotInCubeFrame(orientation: Orientation, slot: string): string {
  const faces = [...slot].map((position) =>
    faceAtPosition(orientation, position as Face),
  );
  // Written the way the rest of the app writes slots, whichever order they came in.
  return (
    EDGE_NAMES.find((name) => faces.every((face) => name.includes(face))) ??
    faces.join("")
  );
}

/**
 * Two-letter summary of the grip: the faces of the *scrambled* cube that the solver put
 * at the bottom and the back. `DB` therefore means the cube was held as scrambled.
 *
 * The export records a field of the same shape but its exact convention is undocumented
 * and not reproduced here; imported values are preserved as they were written.
 */
export function describeGrip(orientation: Orientation): string {
  return `${faceAtPosition(orientation, "D")}${faceAtPosition(orientation, "B")}`;
}
