import { describe, expect, it } from "vitest";
import {
  FACE_AXES,
  angleBetween,
  facesAtPositions,
  orientationScores,
  snapOrientation,
  snapWithBottom,
} from "./gyroGrip";
import { ALL_ORIENTATIONS, GENERATORS, compose, IDENTITY } from "./orientation";
import { IDENTITY as NO_ROTATION, multiply, normalize, type Quat } from "../util/quat";
import { FACES, type Face } from "./moves";

/** A quaternion turning `angle` radians about a unit axis. */
function aboutAxis(axis: readonly [number, number, number], angle: number): Quat {
  const s = Math.sin(angle / 2);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) };
}

const HALF_PI = Math.PI / 2;

/**
 * The quaternion of a whole-cube rotation, in the cube's own frame.
 *
 * `x` turns the way `R` does, `y` the way `U` does and `z` the way `F` does — and a
 * face turn is clockwise as you look at that face, which is a *negative* turn about
 * the axis pointing out of it under the right-hand rule. Hence the minus.
 */
const TURN_QUATS: Record<"x" | "y" | "z", Quat> = {
  x: aboutAxis(FACE_AXES.R, -HALF_PI),
  y: aboutAxis(FACE_AXES.U, -HALF_PI),
  z: aboutAxis(FACE_AXES.F, -HALF_PI),
};

/** Build the pose reached by a sequence of rotation tokens, and the orientation it means. */
function poseFor(tokens: readonly string[]): { quat: Quat; orientation: ReturnType<typeof compose> } {
  let quat: Quat = NO_ROTATION;
  let orientation = IDENTITY;
  for (const token of tokens) {
    const axis = token[0] as "x" | "y" | "z";
    const amount = token.endsWith("'") ? 3 : token.endsWith("2") ? 2 : 1;
    for (let i = 0; i < amount; i++) {
      // The solver turns the cube in the frame they are looking at, which is the
      // reference frame, so each turn is applied on the left of what came before.
      quat = normalize(multiply(TURN_QUATS[axis], quat));
      orientation = compose(orientation, GENERATORS[axis]);
    }
  }
  return { quat, orientation };
}

describe("snapOrientation", () => {
  it("reads the reference pose as the cube held as scrambled", () => {
    const snapped = snapOrientation(NO_ROTATION, NO_ROTATION);
    expect(snapped.orientation).toEqual(IDENTITY);
    expect(snapped.score).toBeCloseTo(1);
    expect(snapped.tokens).toEqual([]);
  });

  it("recognises all twenty-four ways of holding the cube", () => {
    for (const { tokens, orientation } of ALL_ORIENTATIONS) {
      const pose = poseFor(tokens);
      // The rotation tokens and the quaternion have to describe the same thing, or the
      // axis table below them is wrong.
      expect(pose.orientation, tokens.join(" ")).toEqual(orientation);

      const snapped = snapOrientation(pose.quat, NO_ROTATION);
      expect(snapped.orientation, tokens.join(" ")).toEqual(orientation);
      expect(snapped.score).toBeCloseTo(1);
      expect(snapped.margin).toBeGreaterThan(0.4);
    }
  });

  it("still lands on the right one when the cube is held a little crooked", () => {
    const wobble = aboutAxis([0.577, 0.577, 0.577], (12 * Math.PI) / 180);
    for (const { tokens, orientation } of ALL_ORIENTATIONS) {
      const { quat } = poseFor(tokens);
      const snapped = snapOrientation(normalize(multiply(wobble, quat)), NO_ROTATION);
      expect(snapped.orientation, tokens.join(" ")).toEqual(orientation);
    }
  });

  it("is measured against the reference, not the gyroscope's own frame", () => {
    // Whatever pose the reference was captured in, a y from there reads as a y.
    const drifted = aboutAxis([0.18, -0.57, 0.80], 2.1);
    const { quat: relativeTurn, orientation } = poseFor(["y"]);
    const measured = normalize(multiply(drifted, relativeTurn));
    expect(snapOrientation(measured, drifted).orientation).toEqual(orientation);
  });

  it("reports no margin when the cube is halfway between two grips", () => {
    const halfway = aboutAxis(FACE_AXES.U, HALF_PI / 2);
    expect(snapOrientation(halfway, NO_ROTATION).margin).toBeLessThan(0.01);
  });
});

describe("snapWithBottom", () => {
  it("never answers with a grip that has the wrong face underneath", () => {
    for (const bottom of FACES) {
      for (const { tokens } of ALL_ORIENTATIONS) {
        const { quat } = poseFor(tokens);
        const snapped = snapWithBottom(quat, NO_ROTATION, bottom);
        expect(snapped.orientation[bottom], `${bottom} / ${tokens.join(" ")}`).toBe("D");
      }
    }
  });

  it("picks the facing the gyroscope actually saw", () => {
    // z2 turns the cube over: white underneath, green still in front, and red and
    // orange swapped. The y then brings whatever was on the right round to the front,
    // which is now orange — the L face.
    const { quat } = poseFor(["z2", "y"]);
    const snapped = snapWithBottom(quat, NO_ROTATION, "U");
    expect(facesAtPositions(snapped.orientation).D).toBe("U");
    expect(facesAtPositions(snapped.orientation).F).toBe("L");
  });
});

describe("orientationScores", () => {
  it("scores every grip, best first", () => {
    const scores = orientationScores(NO_ROTATION, NO_ROTATION);
    expect(scores).toHaveLength(24);
    expect(scores[0].rotation.orientation).toEqual(IDENTITY);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i].score).toBeLessThanOrEqual(scores[i - 1].score);
    }
  });
});

describe("angleBetween", () => {
  it("measures a quarter turn as ninety degrees", () => {
    expect(angleBetween(NO_ROTATION, TURN_QUATS.y)).toBeCloseTo(90);
    expect(angleBetween(NO_ROTATION, NO_ROTATION)).toBeCloseTo(0);
  });
});

describe("FACE_AXES", () => {
  it("has every face opposite its own opposite", () => {
    const seen = new Set<string>();
    for (const face of FACES as readonly Face[]) {
      seen.add(FACE_AXES[face].join(","));
    }
    expect(seen.size).toBe(6);
  });
});
