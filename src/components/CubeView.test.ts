import { describe, expect, it } from "vitest";
import { buildStandardF2lTarget } from "../cube/f2lTraining";
import { F2L_CASES } from "../cube/f2lCases";
import { get3x3x3 } from "../cube/puzzle";
import { rotationForCrossFace } from "../cube/orientation";
import { orientFaceletsForDisplay } from "./CubeView";
import { patternToFacelets } from "../cube/facelets";

const kpuzzle = await get3x3x3();

describe("CubeView training orientation", () => {
  it("maps the standard white cross to the displayed bottom face", () => {
    const target = buildStandardF2lTarget(kpuzzle, F2L_CASES[0]);
    const orientation = rotationForCrossFace(target.info.crossFace).orientation;
    const displayed = orientFaceletsForDisplay(
      kpuzzle,
      patternToFacelets(target.pattern),
      orientation,
    );

    expect(orientation.U).toBe("D");
    expect([28, 30, 32, 34].map((index) => displayed[index])).toEqual([
      "U",
      "U",
      "U",
      "U",
    ]);
  });
});
