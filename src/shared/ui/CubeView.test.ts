import { describe, expect, it } from "vitest";
import { buildF2lCatalogueTarget, f2lTrainingGrip } from "../../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../../cube/f2lTrainingCases";
import { get3x3x3 } from "../../cube/puzzle";
import { reorientMove } from "../../cube/orientation";
import { orientFaceletsForDisplay } from "../../cube/frames";
import { patternToFacelets } from "../../cube/facelets";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ControllerContext } from "../../app/useController";
import { Controller } from "../../app/Controller";
import { CubeModel } from "../../cube/model";
import { CubeView } from "./CubeView";
import { trainingGuideMove } from "../../cube/training";

const kpuzzle = await get3x3x3();
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;

describe("CubeView training orientation", () => {
  it("only includes and locks the instructional overlay for a supplied 3D guide move", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    const state = controller.snapshot();
    const markup = (visualization: "3D" | "2D" | "off", guideMove = null as ReturnType<typeof trainingGuideMove>) => renderToStaticMarkup(
      createElement(ControllerContext.Provider, { value: controller }, createElement(CubeView, {
        settings: { ...state.settings, visualization }, facelets: state.cubeFacelets, gyroSupported: false,
        live: true, scramble: "", guideMove,
      })),
    );
    expect(markup("3D")).not.toContain("cube-move-guide");
    expect(markup("3D")).not.toContain("cube-player-host guided");
    expect(markup("3D", trainingGuideMove("R"))).toContain("cube-move-guide outer");
    expect(markup("3D", trainingGuideMove("R"))).toContain("cube-player-host guided");
    expect(markup("2D", trainingGuideMove("R"))).not.toContain("cube-move-guide");
    expect(markup("off", trainingGuideMove("R"))).toBe("");
  });
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
