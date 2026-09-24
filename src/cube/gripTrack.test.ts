import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import {
  GRIP_WEIGHTS,
  decodeGripTrack,
  encodeGripTrack,
  rewriteWithRotations,
  trackGrip,
} from "./gripTrack";
import { FACE_AXES } from "./gyroGrip";
import { GENERATORS, IDENTITY, compose, type Orientation } from "./orientation";
import { IDENTITY as NO_TURN, multiply, normalize, type Quat } from "../util/quat";
import type { TimedMove } from "./notation";
import { get3x3x3 } from "./puzzle";
import { patternToFacelets } from "./facelets";

const kpuzzle = await get3x3x3();

function aboutAxis(axis: readonly [number, number, number], degrees: number): Quat {
  const angle = (degrees * Math.PI) / 180;
  const s = Math.sin(angle / 2);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) };
}

/** Wherever the gyroscope's own zero happens to be. */
const REFERENCE = normalize(aboutAxis([0.31, -0.62, 0.72], 143));

/** A whole-cube turn is clockwise looking at the face its axis comes out of. */
const TURNS: Record<"x" | "y" | "z", Quat> = {
  x: aboutAxis(FACE_AXES.R, -90),
  y: aboutAxis(FACE_AXES.U, -90),
  z: aboutAxis(FACE_AXES.F, -90),
};

/** The pose and the orientation reached by turning the cube from the reference. */
function grip(tokens: string): { pose: Quat; orientation: Orientation } {
  let turn: Quat = NO_TURN;
  let orientation = IDENTITY;
  for (const token of tokens.split(" ").filter(Boolean)) {
    const axis = token[0] as "x" | "y" | "z";
    const amount = token.endsWith("'") ? 3 : token.endsWith("2") ? 2 : 1;
    for (let i = 0; i < amount; i++) {
      turn = normalize(multiply(TURNS[axis], turn));
      orientation = compose(orientation, GENERATORS[axis]);
    }
  }
  // The solver's rotations are in the frame they are looking at, so the turn goes on
  // the right of the reference.
  return { pose: normalize(multiply(REFERENCE, turn)), orientation };
}

/** A solve: moves at fixed spacing, each with the grip it was turned from. */
function solve(
  entries: readonly [move: string, gripTokens: string, gapMs: number][],
): { moves: TimedMove[]; readings: Quat[] } {
  const moves: TimedMove[] = [];
  const readings: Quat[] = [];
  let t = 0;
  for (const [move, tokens, gap] of entries) {
    t += gap;
    moves.push({ move, t });
    readings.push(grip(tokens).pose);
  }
  return { moves, readings };
}

const track = (
  input: ReturnType<typeof solve>,
  crossFace: Parameters<typeof trackGrip>[0]["crossFace"] = "U",
) => trackGrip({ ...input, reference: REFERENCE, crossFace });

describe("trackGrip", () => {
  it("has nothing to say about a solve with no moves", () => {
    const result = trackGrip({
      moves: [],
      readings: [],
      reference: REFERENCE,
      crossFace: "U",
    });
    expect(result.orientations).toEqual([]);
    expect(result.inspection).toEqual([]);
  });

  it("reads the inspection turn off the first move", () => {
    const result = track(
      solve([
        ["R", "z2", 0],
        ["U", "z2", 200],
      ]),
    );
    expect(result.inspection).toEqual(["z2"]);
    expect(result.orientations[0]).toEqual(grip("z2").orientation);
  });

  it("follows a rotation made during a pause", () => {
    const result = track(
      solve([
        ["R", "z2", 0],
        ["U", "z2", 150],
        // A clear pause, then everything afterwards is a quarter turn round.
        ["R", "z2 y", 600],
        ["U", "z2 y", 150],
        ["R", "z2 y", 150],
      ]),
    );
    expect(result.orientations[1]).toEqual(grip("z2").orientation);
    expect(result.orientations[2]).toEqual(grip("z2 y").orientation);
    expect(result.orientations[4]).toEqual(grip("z2 y").orientation);
  });

  it("ignores a twitch between two fast turns", () => {
    // The gyroscope catches the cube mid-regrip on one move of a trigger. There was
    // no time to turn the cube out and back, so it did not happen.
    const result = track(
      solve([
        ["R", "z2", 0],
        ["U", "z2", 90],
        ["R'", "z2 y", 40],
        ["U'", "z2", 40],
        ["R", "z2", 90],
      ]),
    );
    expect(new Set(result.orientations)).toHaveLength(1);
    expect(result.orientations[2]).toEqual(grip("z2").orientation);
  });

  it("does not write a y and a y' that cancel each other out", () => {
    const input = solve([
      ["R", "z2", 0],
      ["U", "z2 y", 60],
      ["R'", "z2", 60],
      ["U'", "z2", 60],
    ]);
    const written = rewriteWithRotations(input.moves, track(input).orientations);
    expect(written.filter((m) => "xyz".includes(m.move[0]))).toEqual([]);
    // Four turns in, four turns out, none of them relabelled by a phantom rotation.
    expect(written.map((m) => m.move)).toEqual(["L", "D", "L'", "D'"]);
  });

  it("keeps a rotation the solver really had time for, even a long one", () => {
    const result = track(
      solve([
        ["R", "z2", 0],
        ["U", "z2", 150],
        ["F", "z2 y2", 900],
        ["U", "z2 y2", 150],
        ["F'", "z2 y2", 150],
        ["U'", "z2 y2", 150],
      ]),
    );
    expect(result.orientations[0]).toEqual(grip("z2").orientation);
    expect(result.orientations[5]).toEqual(grip("z2 y2").orientation);
  });

  it("prefers to keep the cross face underneath when a reading is ambiguous", () => {
    // Halfway between two grips: one keeps white down, the other tips it off.
    const halfway = normalize(
      multiply(REFERENCE, aboutAxis(FACE_AXES.R, -45)),
    );
    const result = trackGrip({
      moves: [
        { move: "R", t: 0 },
        { move: "U", t: 150 },
      ],
      readings: [halfway, halfway],
      reference: REFERENCE,
      crossFace: "D",
    });
    for (const orientation of result.orientations) {
      expect(orientation.D).toBe("D");
    }
  });

  it("says so when the cross face leaves the bottom", () => {
    const result = track(
      solve([
        ["R", "z2", 0],
        ["U", "z2", 150],
      ]),
      "D", // A white cross would be down after z2; a yellow one is now on top.
    );
    expect(result.warnings.join(" ")).toContain("left the bottom");
  });

  it("carries on when the cube reported nothing", () => {
    const result = trackGrip({
      moves: [
        { move: "R", t: 0 },
        { move: "U", t: 150 },
      ],
      readings: [null, null],
      reference: REFERENCE,
      crossFace: "U",
    });
    expect(result.orientations).toHaveLength(2);
    expect(result.confidence).toBe(0);
  });

  it("is sure of itself when every reading is clean, and not when they are not", () => {
    const clean = track(
      solve([
        ["R", "z2", 0],
        ["U", "z2", 150],
        ["R'", "z2", 150],
      ]),
    );
    expect(clean.confidence).toBeCloseTo(1);

    // The same solve with the cube held halfway between two grips throughout.
    const halfway = normalize(multiply(REFERENCE, aboutAxis(FACE_AXES.U, -45)));
    const muddled = trackGrip({
      moves: clean.orientations.map((_, i) => ({ move: "R", t: i * 150 })),
      readings: clean.orientations.map(() => halfway),
      reference: REFERENCE,
      crossFace: "U",
    });
    expect(muddled.confidence).toBeLessThan(0.2);
  });
});

describe("rewriteWithRotations", () => {
  it("writes turns for the face the solver was looking at", () => {
    const held = grip("z2").orientation;
    const written = rewriteWithRotations(
      [
        { move: "L", t: 0 },
        { move: "U", t: 100 },
      ],
      [held, held],
    );
    // Held upside down, the raw L is the solver's R and the raw U is their D.
    expect(written.map((m) => m.move)).toEqual(["R", "D"]);
  });

  it("puts the rotation in where the grip changed", () => {
    const written = rewriteWithRotations(
      [
        { move: "R", t: 0 },
        { move: "R", t: 100 },
      ],
      [IDENTITY, GENERATORS.y],
    );
    expect(written.map((m) => m.move)).toEqual(["R", "y", "F"]);
  });

  it("is a real reconstruction: the written solve solves the same cube", () => {
    // Turn the cube partway through, and what comes out has to do to a cube held one
    // way exactly what the raw moves did to a cube held the other.
    const raw = ["R", "U", "F", "L", "D", "B"].map((move, t) => ({ move, t: t * 100 }));
    const orientations = [
      IDENTITY,
      IDENTITY,
      GENERATORS.y,
      GENERATORS.y,
      compose(GENERATORS.y, GENERATORS.y),
      compose(GENERATORS.y, GENERATORS.y),
    ];
    const written = rewriteWithRotations(raw, orientations);

    const direct = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg(raw.map((m) => m.move).join(" ")));
    const asWritten = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg(written.map((m) => m.move).join(" ")));
    // The written stream ends with the cube rotated, so compare with that undone.
    const trailing = written.filter((m) => "xyz".includes(m.move[0]));
    const undo = new Alg(trailing.map((m) => m.move).join(" ")).invert();
    expect(patternToFacelets(asWritten.applyAlg(undo))).toBe(
      patternToFacelets(direct),
    );
  });
});

describe("GRIP_WEIGHTS", () => {
  it("prices a rotation a solver had no time for above one they did", () => {
    expect(GRIP_WEIGHTS.regripMs).toBeGreaterThan(0);
    expect(GRIP_WEIGHTS.maxRegripFactor).toBeGreaterThan(1);
  });
});

describe("encodeGripTrack", () => {
  it("survives a round trip", () => {
    const input = solve([
      ["R", "z2", 0],
      ["U", "z2", 150],
      ["F", "z2 y", 700],
      ["U'", "z2 y", 150],
    ]);
    const tracked = track(input);
    const restored = decodeGripTrack(encodeGripTrack(tracked));

    expect(restored).not.toBeNull();
    expect(restored!.inspection).toEqual(tracked.inspection);
    expect(restored!.orientations).toEqual(tracked.orientations);
    // And writes the same solve out as the track it came from.
    expect(rewriteWithRotations(input.moves, restored!.orientations)).toEqual(
      rewriteWithRotations(input.moves, tracked.orientations),
    );
  });

  it("keeps a whole solve in a handful of bytes", () => {
    const input = solve(
      Array.from({ length: 60 }, (_, i): [string, string, number] => [
        "R",
        "z2",
        i === 0 ? 0 : 120,
      ]),
    );
    expect(encodeGripTrack(track(input)).length).toBeLessThan(200);
  });

  it("refuses anything that is not a track", () => {
    expect(decodeGripTrack("")).toBeNull();
    expect(decodeGripTrack("z2 y|UB1")).toBeNull();
    expect(decodeGripTrack("z2 y|ZZ")).toBeNull();
    // A grip with the same face underneath and behind cannot be held.
    expect(decodeGripTrack("z2 y|UU")).toBeNull();
  });

  it("reads back a track with no inspection turn", () => {
    const restored = decodeGripTrack("|DBDB");
    expect(restored?.inspection).toEqual([]);
    expect(restored?.orientations).toHaveLength(2);
  });
});
