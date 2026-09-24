import { describe, expect, it } from "vitest";
import { LiveGrip } from "./liveGrip";
import { facesAtPositions } from "./gyroGrip";
import { IDENTITY, multiply, normalize, type Quat } from "../util/quat";
import { FACE_AXES } from "./gyroGrip";

function aboutAxis(axis: readonly [number, number, number], degrees: number): Quat {
  const angle = (degrees * Math.PI) / 180;
  const s = Math.sin(angle / 2);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) };
}

/** A whole-cube turn: clockwise looking at the face the axis comes out of. */
const Y = aboutAxis(FACE_AXES.U, -90);
const Z2 = aboutAxis(FACE_AXES.F, -180);

/** Somewhere arbitrary, standing in for however the gyroscope's frame has drifted. */
const DRIFTED = normalize(aboutAxis([0.31, -0.62, 0.72], 143));

/**
 * The pose reached by turning the cube from `reference`.
 *
 * A solver's rotations are in the frame they are looking at, not the gyroscope's, so
 * the turn goes on the right: it is the reference pose *then* the turn, which is what
 * makes `relative(reference, pose)` come back as the turn itself.
 */
const turn = (reference: Quat, by: Quat) => normalize(multiply(reference, by));

function front(grip: LiveGrip): string | null {
  const orientation = grip.orientation;
  return orientation ? facesAtPositions(orientation).F : null;
}

describe("LiveGrip", () => {
  it("says nothing until the scramble is finished", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    expect(grip.locked).toBe(false);
    expect(grip.orientation).toBeNull();
    expect(grip.samples).toHaveLength(0);
  });

  it("takes the last pose seen while scrambling as the reference", () => {
    const grip = new LiveGrip();
    // The cube is jostled about while the scramble goes on; only where it ends matters.
    grip.sample(turn(DRIFTED, Y), 0);
    grip.sample(DRIFTED, 100);
    grip.lockReference();

    expect(grip.reference).toEqual(DRIFTED);
    // Held as scrambled, so green is still in front.
    expect(front(grip)).toBe("F");
  });

  it("measures the turn away from the reference, whatever frame the gyroscope used", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();

    grip.sample(turn(DRIFTED, Y), 500);
    // A y brings whatever was on the right round to the front: red, the R face.
    expect(front(grip)).toBe("R");

    grip.sample(turn(DRIFTED, Z2), 1000);
    const at = facesAtPositions(grip.orientation!);
    expect(at.D).toBe("U");
    expect(at.F).toBe("F");
  });

  it("keeps readings from the moment the reference is locked", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    for (let i = 1; i <= 5; i++) grip.sample(turn(DRIFTED, aboutAxis(FACE_AXES.U, -i * 15)), i * 100);
    expect(grip.samples.length).toBe(6);
    expect(grip.samples[0].t).toBe(0);
  });

  it("drops readings that are too close together to say anything new", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    for (let t = 1; t < 20; t++) grip.sample(DRIFTED, t);
    expect(grip.samples).toHaveLength(1);
  });

  it("keeps a reading that is close in time but a real movement", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    grip.sample(turn(DRIFTED, aboutAxis(FACE_AXES.U, -20)), 5);
    expect(grip.samples).toHaveLength(2);
  });

  it("finds the reading nearest a moment", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    grip.sample(turn(DRIFTED, Y), 1000);
    expect(grip.sampleAt(-50)?.t).toBe(0);
    expect(grip.sampleAt(400)?.t).toBe(0);
    expect(grip.sampleAt(600)?.t).toBe(1000);
    expect(grip.sampleAt(5000)?.t).toBe(1000);
    expect(facesAtPositions(grip.at(900)!.orientation).F).toBe("R");
  });

  it("starts sighting the scrambling pose again for the next solve", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    grip.sample(turn(DRIFTED, Y), 500);

    grip.reset();
    expect(grip.locked).toBe(false);
    expect(grip.samples).toHaveLength(0);

    // The solver turns the cube back to scramble the next one; that becomes the reference.
    const nextPose = turn(DRIFTED, aboutAxis(FACE_AXES.R, -90));
    grip.sample(nextPose, 1000);
    grip.lockReference();
    expect(grip.reference).toEqual(nextPose);
    expect(front(grip)).toBe("F");
  });

  it("is unmoved by locking twice", () => {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    grip.sample(turn(DRIFTED, Y), 500);
    grip.lockReference();
    expect(grip.reference).toEqual(DRIFTED);
    expect(front(grip)).toBe("R");
  });

  it("copes with a cube that never reports its orientation", () => {
    const grip = new LiveGrip();
    grip.lockReference();
    expect(grip.active).toBe(false);
    expect(grip.orientation).toBeNull();
    expect(grip.at(0)).toBeNull();
    expect(grip.sampleAt(0)).toBeNull();
  });
});

describe("LiveGrip reference", () => {
  it("is the identity pose when the cube was scrambled facing the gyroscope's own zero", () => {
    const grip = new LiveGrip();
    grip.sample(IDENTITY, 0);
    grip.lockReference();
    expect(front(grip)).toBe("F");
  });
});

describe("holdBottom", () => {
  /** A solve in progress: white underneath, green facing the solver. */
  function solving(): LiveGrip {
    const grip = new LiveGrip();
    grip.sample(DRIFTED, 0);
    grip.lockReference();
    grip.sample(turn(DRIFTED, Z2), 100);
    grip.holdBottom("U");
    return grip;
  }

  it("will not tip the cube over, whatever the reading says", () => {
    const grip = solving();
    // The reading comes loose and claims the cube is on its side.
    grip.sample(turn(DRIFTED, aboutAxis(FACE_AXES.R, -90)), 1000);
    expect(facesAtPositions(grip.orientation!).D).toBe("U");
  });

  it("still follows the side facing the solver", () => {
    const grip = solving();
    // z2 then y: white stays underneath, and orange comes round to the front. The
    // later turn goes on the left, since each one acts in the frame already reached.
    const z2y = normalize(multiply(aboutAxis(FACE_AXES.U, -90), Z2));
    grip.sample(turn(DRIFTED, z2y), 1000);
    grip.sample(turn(DRIFTED, z2y), 2000);
    expect(facesAtPositions(grip.steady!).D).toBe("U");
    expect(facesAtPositions(grip.steady!).F).toBe("L");
  });

  it("goes back to considering every grip when the hold is lifted", () => {
    const grip = solving();
    const onItsSide = turn(DRIFTED, aboutAxis(FACE_AXES.R, -90));
    grip.sample(onItsSide, 1000);
    expect(facesAtPositions(grip.orientation!).D).toBe("U");

    grip.holdBottom(null);
    expect(facesAtPositions(grip.orientation!).D).not.toBe("U");
  });

  it("re-reads the latest reading as soon as the hold changes", () => {
    const grip = solving();
    grip.sample(turn(DRIFTED, aboutAxis(FACE_AXES.R, -90)), 1000);
    // Without re-reading, the grip would still reflect the old constraint.
    grip.holdBottom("F");
    expect(facesAtPositions(grip.orientation!).D).toBe("F");
  });

  it("is forgotten when a new scramble starts", () => {
    const grip = solving();
    grip.reset();
    expect(grip.heldBottom).toBeNull();
  });
});
