import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { handMove, cubeMove, handAlgorithm, cubeAlgorithm, orientFaceletsForDisplay, reframe } from "./frames";
import { patternToFacelets, faceletsToPattern } from "./facelets";
import { GENERATORS } from "./orientation";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

describe("frame boundaries", () => {
  it("converts every move of an algorithm and reverses the conversion", () => {
    const raw = "R U R'";
    const held = handAlgorithm(raw, GENERATORS.y);
    expect(held).toBe("F U F'");
    expect(cubeAlgorithm(held, GENERATORS.y)).toBe(raw);
    expect(handAlgorithm("(R U)2", GENERATORS.y)).toBe("F U F U");
  });

  it("rejects complete algorithms at the single-move boundary", () => {
    expect(() => handMove("R U R'", GENERATORS.y)).toThrow(/handAlgorithm/);
    expect(() => cubeMove("R U R'", GENERATORS.y)).toThrow(/cubeAlgorithm/);
  });

  it("keeps physical display rotation distinct from case reframing", () => {
    const physical = kpuzzle.defaultPattern().applyAlg("R U F");
    const displayed = faceletsToPattern(kpuzzle, orientFaceletsForDisplay(kpuzzle, patternToFacelets(physical), GENERATORS.y));
    const reframed = reframe(kpuzzle, physical, new Alg("y"));
    expect(patternToFacelets(displayed)).toBe(patternToFacelets(physical.applyAlg("y")));
    expect(displayed.isIdentical(reframed)).toBe(false);
    expect(reframed.patternData.CENTERS.pieces).toEqual(kpuzzle.defaultPattern().patternData.CENTERS.pieces);
    expect(displayed.patternData.CENTERS.pieces).not.toEqual(physical.patternData.CENTERS.pieces);
  });
});
