import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { FACES } from "./moves";
import {
  describeGrip,
  reorientMoves,
  rotationForCrossFace,
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

describe("describeGrip", () => {
  it("reports the faces placed at the bottom and the back", () => {
    expect(describeGrip(rotationForCrossFace("D").orientation)).toBe("DB");
    expect(describeGrip(rotationForCrossFace("U").orientation)).toBe("UB");
  });
});
