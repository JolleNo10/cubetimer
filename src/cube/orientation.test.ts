import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { FACES, OPPOSITE } from "./moves";
import {
  ALL_ORIENTATIONS,
  GENERATORS,
  IDENTITY,
  compose,
  describeGrip,
  faceAtPosition,
  frontsFor,
  reorientMove,
  reorientMoves,
  rotationForCrossFace,
  rotationForGrip,
  rotationTokensBetween,
  slotInCubeFrame,
} from "./orientation";
import { get3x3x3 } from "./puzzle";
import { patternToFacelets } from "./facelets";

const kpuzzle = await get3x3x3();

describe("rotationForCrossFace", () => {
  it("does nothing when the cross is already down", () => {
    const rotation = rotationForCrossFace("D");
    expect(rotation.tokens).toEqual([]);
    expect(rotation.orientation.D).toBe("D");
  });

  it("brings any cross face to the bottom", () => {
    for (const face of FACES) {
      const rotation = rotationForCrossFace(face);
      expect(rotation.orientation[face], face).toBe("D");
      expect(rotation.tokens.length).toBeLessThanOrEqual(2);
    }
  });

  it("uses z2 for a cross made on the U face", () => {
    // The stream from a solve held upside down: raw L becomes R, raw U becomes D.
    const rotation = rotationForCrossFace("U");
    expect(rotation.tokens).toEqual(["z2"]);
    expect(
      reorientMoves(
        [
          { move: "L", t: 0 },
          { move: "R", t: 1 },
          { move: "U", t: 2 },
          { move: "B'", t: 3 },
        ],
        rotation.orientation,
      ).map((m) => m.move),
    ).toEqual(["R", "L", "D", "B'"]);
  });

  it("is a real rotation: the rotated moves solve the rotated cube", () => {
    // Applying the rotation tokens then the rewritten moves must equal applying the
    // original moves then the rotation.
    for (const face of FACES) {
      const { tokens, orientation } = rotationForCrossFace(face);
      const moves = "R U2 F' D L' B".split(" ").map((move, t) => ({ move, t }));
      const direct = kpuzzle
        .defaultPattern()
        .applyAlg(new Alg(moves.map((m) => m.move).join(" ")))
        .applyAlg(new Alg(tokens.join(" ")));
      const rotated = kpuzzle
        .defaultPattern()
        .applyAlg(new Alg(tokens.join(" ")))
        .applyAlg(
          new Alg(
            reorientMoves(moves, orientation)
              .map((m) => m.move)
              .join(" "),
          ),
        );
      expect(patternToFacelets(rotated), face).toBe(patternToFacelets(direct));
    }
  });
});

describe("showing the cube the way it is held", () => {
  /**
   * The live view turns the cube over and then relabels the moves coming from it. For
   * that to stay honest, turning the displayed cube by the relabelled move has to land
   * on the same state as turning the real cube and then turning it over.
   */
  it("keeps the turned-over view in step with the real cube", () => {
    for (const face of FACES) {
      const { tokens, orientation } = rotationForCrossFace(face);
      const rotation = new Alg(tokens.join(" "));
      let real = kpuzzle.defaultPattern().applyAlg(new Alg("R U2 F' L D'"));
      let shown = real.applyAlg(rotation);

      for (const move of ["U", "R'", "F2", "D", "B'", "L2"]) {
        real = real.applyMove(move);
        shown = shown.applyMove(reorientMove(move, orientation));
        expect(patternToFacelets(shown), `${face} after ${move}`).toBe(
          patternToFacelets(real.applyAlg(rotation)),
        );
      }
    }
  });

  it("puts the cross colour underneath", () => {
    // Held white down and green forward, the top face becomes yellow.
    const { tokens } = rotationForCrossFace("U");
    const shown = kpuzzle.defaultPattern().applyAlg(new Alg(tokens.join(" ")));
    const facelets = patternToFacelets(shown);
    expect(facelets.slice(0, 9)).toBe("DDDDDDDDD"); // yellow on top
    expect(facelets.slice(27, 36)).toBe("UUUUUUUUU"); // white underneath
    expect(facelets.slice(18, 27)).toBe("FFFFFFFFF"); // green still in front
  });
});

describe("describeGrip", () => {
  it("reports the faces placed at the bottom and the back", () => {
    expect(describeGrip(rotationForCrossFace("D").orientation)).toBe("DB");
    expect(describeGrip(rotationForCrossFace("U").orientation)).toBe("UB");
  });
});

describe("rotationForGrip", () => {
  it("puts both the chosen faces where they were asked for", () => {
    for (const bottom of FACES) {
      for (const front of frontsFor(bottom)) {
        const grip = rotationForGrip(bottom, front);
        expect(grip, `${bottom}/${front}`).not.toBeNull();
        expect(grip!.orientation[bottom], `${bottom} down`).toBe("D");
        expect(grip!.orientation[front], `${front} front`).toBe("F");
      }
    }
  });

  it("offers four fronts for any bottom, never the opposite face", () => {
    expect(frontsFor("D")).toEqual(["R", "F", "L", "B"]);
    expect(frontsFor("F")).toEqual(["U", "R", "D", "L"]);
    for (const bottom of FACES) expect(frontsFor(bottom)).toHaveLength(4);
  });

  it("refuses a grip that cannot exist", () => {
    expect(rotationForGrip("U", "U")).toBeNull();
    expect(rotationForGrip("U", "D")).toBeNull();
  });

  it("agrees with the cross-face grip when the front is left alone", () => {
    // White underneath with green still in front is the z2 the cross setting picks.
    expect(rotationForGrip("U", "F")!.tokens).toEqual(
      rotationForCrossFace("U").tokens,
    );
  });
});

describe("slotInCubeFrame", () => {
  it("leaves the slots alone when the cube is held as scrambled", () => {
    const { orientation } = rotationForCrossFace("D");
    for (const slot of ["FR", "FL", "BL", "BR"]) {
      expect(slotInCubeFrame(orientation, slot)).toBe(slot);
    }
  });

  it("turns the slots over with the cube for a white cross", () => {
    // z2 puts white underneath and leaves green in front, so the right of the cube in
    // the hand is the orange face. The back-right slot is blue-orange, not blue-red.
    const { orientation } = rotationForGrip("U", "F")!;
    expect(slotInCubeFrame(orientation, "BR")).toBe("BL");
    expect(slotInCubeFrame(orientation, "FR")).toBe("FL");
    expect(slotInCubeFrame(orientation, "FL")).toBe("FR");
    expect(slotInCubeFrame(orientation, "BL")).toBe("BR");
  });

  it("names the same four slots whatever the grip", () => {
    for (const bottom of FACES) {
      for (const front of frontsFor(bottom)) {
        const grip = rotationForGrip(bottom, front)!;
        const named = ["FR", "FL", "BL", "BR"].map((slot) =>
          slotInCubeFrame(grip.orientation, slot),
        );
        // The slots of the cross face, by whatever route: four of them, all distinct,
        // and none of them touching the face the cross is on.
        expect(new Set(named).size, `${bottom}/${front}`).toBe(4);
        for (const slot of named) {
          expect(slot.includes(bottom), `${bottom}/${front}: ${slot}`).toBe(false);
          expect(slot.includes(OPPOSITE[bottom]), `${bottom}/${front}: ${slot}`).toBe(
            false,
          );
        }
      }
    }
  });

  it("reads a position straight off the grip", () => {
    const { orientation } = rotationForGrip("U", "F")!;
    expect(faceAtPosition(orientation, "D")).toBe("U");
    expect(faceAtPosition(orientation, "R")).toBe("L");
  });
});

describe("ALL_ORIENTATIONS", () => {
  it("is each of the twenty-four grips exactly once", () => {
    const keys = ALL_ORIENTATIONS.map(({ orientation }) =>
      FACES.map((face) => orientation[face]).join(""),
    );
    expect(new Set(keys).size).toBe(24);
  });

  it("reaches every grip in at most two rotations", () => {
    for (const { tokens } of ALL_ORIENTATIONS) {
      expect(tokens.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("rotationTokensBetween", () => {
  it("asks for nothing when the cube is already held that way", () => {
    for (const { orientation } of ALL_ORIENTATIONS) {
      expect(rotationTokensBetween(orientation, orientation)).toEqual([]);
    }
  });

  it("names the turn from one grip to the next", () => {
    // Held as scrambled, a single y is all it takes to face the next side.
    expect(rotationTokensBetween(IDENTITY, GENERATORS.y)).toEqual(["y"]);
  });

  it("gets from any grip to any other", () => {
    for (const from of ALL_ORIENTATIONS) {
      for (const to of ALL_ORIENTATIONS) {
        const tokens = rotationTokensBetween(from.orientation, to.orientation);
        // Turning the cube by those tokens really has to land on the target grip.
        let reached = from.orientation;
        for (const token of tokens) {
          const axis = token[0] as "x" | "y" | "z";
          const amount = token.endsWith("'") ? 3 : token.endsWith("2") ? 2 : 1;
          for (let i = 0; i < amount; i++) {
            reached = compose(reached, GENERATORS[axis]);
          }
        }
        expect(reached, `${from.tokens} -> ${to.tokens}`).toEqual(to.orientation);
      }
    }
  });
});
