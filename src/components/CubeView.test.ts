import { describe, expect, it } from "vitest";
import { buildF2lCatalogueTarget, f2lTrainingGrip } from "../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../cube/f2lTrainingCases";
import { get3x3x3 } from "../cube/puzzle";
import { reorientMove } from "../cube/orientation";
import { orientFaceletsForDisplay } from "./CubeView";
import { patternToFacelets } from "../cube/facelets";

const kpuzzle = await get3x3x3();
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;

describe("CubeView training orientation", () => {
  it("maps the standard white cross to the displayed bottom face", () => {
    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    const orientation = f2lTrainingGrip(target.info);
    const displayed = orientFaceletsForDisplay(
      kpuzzle,
      patternToFacelets(target.pattern),
      orientation,
    );

    expect(orientation.U).toBe("D");
    expect(orientation.D).toBe("U");
    expect(orientation.R).toBe("L");
    expect(orientation.L).toBe("R");
    expect(orientation.F).toBe("F");
    expect(orientation.B).toBe("B");
    expect(reorientMove("L", orientation)).toBe("R");
    expect(reorientMove("D", orientation)).toBe("U");
    expect([28, 30, 32, 34].map((index) => displayed[index])).toEqual([
      "U",
      "U",
      "U",
      "U",
    ]);
  });
});
