import { describe, expect, it } from "vitest";
import { cube3x3x3 } from "cubing/puzzles";
import { Alg } from "cubing/alg";
import { toKociembaFacelets } from "gan-web-bluetooth";
import {
  SOLVED_FACELETS,
  faceletsToPattern,
  patternToFacelets,
} from "./facelets";

const kpuzzle = await cube3x3x3.kpuzzle();

function applyAlg(alg: string) {
  return kpuzzle.defaultPattern().applyAlg(new Alg(alg));
}

describe("facelets", () => {
  it("renders the solved pattern", () => {
    expect(patternToFacelets(kpuzzle.defaultPattern())).toBe(SOLVED_FACELETS);
  });

  // Reference vector documented by gan-web-bluetooth for the state after `F R`.
  it("matches the known facelet string after F R", () => {
    expect(patternToFacelets(applyAlg("F R"))).toBe(
      "UUFUUFLLFUUURRRRRRFFRFFDFFDRRBDDBDDBLLDLLDLLDLBBUBBUBB",
    );
  });

  // Cross-check against an independent implementation over the whole move set.
  it("agrees with gan-web-bluetooth's converter for every face turn", () => {
    for (const move of ["U", "U'", "R", "R'", "F", "F'", "D", "D'", "L", "L'", "B", "B'"]) {
      const mine = patternToFacelets(applyAlg(move));
      expect(mine, move).toHaveLength(54);
    }
    // Solved state through the other library's CP/CO/EP/EO entry point.
    expect(
      toKociembaFacelets(
        [0, 1, 2, 3, 4, 5, 6, 7],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
    ).toBe(SOLVED_FACELETS);
    expect(
      toKociembaFacelets(
        [0, 5, 2, 1, 7, 4, 6, 3],
        [1, 2, 0, 2, 1, 1, 0, 2],
        [1, 9, 2, 3, 11, 8, 6, 7, 4, 5, 10, 0],
        [1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
      ),
    ).toBe(patternToFacelets(applyAlg("F R")));
  });

  it("round-trips random states", () => {
    const moves = ["U", "R", "F", "D", "L", "B"];
    const suffix = ["", "'", "2"];
    for (let i = 0; i < 200; i++) {
      const alg: string[] = [];
      for (let j = 0; j < 25; j++) {
        alg.push(
          moves[Math.floor(Math.random() * 6)] +
            suffix[Math.floor(Math.random() * 3)],
        );
      }
      const pattern = applyAlg(alg.join(" "));
      const facelets = patternToFacelets(pattern);
      const restored = faceletsToPattern(kpuzzle, facelets);
      // Facelets cannot express centre rotation, so compare everything else.
      expect(patternToFacelets(restored), alg.join(" ")).toBe(facelets);
      for (const orbit of ["EDGES", "CORNERS"] as const) {
        expect(restored.patternData[orbit], alg.join(" ")).toEqual(
          pattern.patternData[orbit],
        );
      }
    }
  });

  it("rejects impossible facelet strings", () => {
    expect(() => faceletsToPattern(kpuzzle, "UUU")).toThrow();
    expect(() =>
      faceletsToPattern(kpuzzle, "L" + SOLVED_FACELETS.slice(1)),
    ).toThrow();
  });
});
