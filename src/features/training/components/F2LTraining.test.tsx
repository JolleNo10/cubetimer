import { buildF2lCatalogueTarget } from "../../../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../../../cube/f2lTrainingCases";
import { createTrainingAlgorithmPreference } from "../trainingAlgorithmPreferences";
import { catalogueIdentityForTarget } from "../../../app/trainingCatalogue";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControllerContext } from "../../../app/useController";
import { Controller } from "../../../app/Controller";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import { shortF2lCaseLabel } from "../../../cube/f2lTrainingCases";
import type { F2lTrainingTargetInfo } from "../../../cube/f2lTraining";
import { F2LTraining } from "./F2LTraining";

const kpuzzle = await get3x3x3();

function render(controller: Controller) {
  return renderToStaticMarkup(
    <ControllerContext.Provider value={controller}>
      <F2LTraining />
    </ControllerContext.Provider>,
  );
}

describe("F2L training library presentation", () => {
  it("shows the Basic default and switches to all 54 grouped Advanced cards", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("training");
    const basic = render(controller);
    expect(basic).toContain('aria-label="F2L case library"');
    expect(basic).toContain('aria-pressed="true">Basic</button>');
    expect(basic).toContain("41 cases");
    expect(basic.match(/class="f2l-case-button/g)).toHaveLength(41);
    expect(basic.match(/<polygon/g)).toHaveLength(41 * 27);
    expect(basic).toContain('fill="#52575d"');
    controller.setF2lLibrary("advanced");
    const advanced = render(controller);
    expect(advanced).toContain('aria-pressed="true">Advanced</button>');
    expect(advanced).toContain("54 cases");
    expect(advanced.match(/class="f2l-case-button/g)).toHaveLength(54);
    expect(advanced).toContain('aria-label="AF2L 1a, Front Right"');
    expect(advanced).toContain('class="f2l-case-number">#1a</span>');
    expect(advanced).not.toContain("A#");
    expect(advanced).toContain("Trapped Corner");
    expect(advanced).toContain("Trapped Edge");
    expect(advanced).toContain("Both Pieces Trapped");
    expect(advanced.match(/<polygon/g)).toHaveLength(54 * 27);
    expect(advanced).not.toMatch(/data-facelet="(?:2[7-9]|[3-5]\d)"/);
    expect(advanced).not.toContain("advanced-net");
    expect(advanced).toContain('fill="#52575d"');
    expect(advanced).not.toContain("fill-opacity");
  });

  it("highlights only the selected case in the active catalogue", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("training");
    controller.setF2lLibrary("advanced");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("AF2L 3");
    expect(render(controller).match(/class="f2l-case-button selected"/g)).toHaveLength(1);
    expect(render(controller)).toContain("Advanced F2L");
    controller.training.state.update((state) => ({
      ...state,
      target: { ...(state.target as F2lTrainingTargetInfo), origin: { kind: "solve-step", solveId: "exact", stepName: "F2L Slot 1", slot: "FL" } },
    }));
    expect(render(controller)).not.toContain('class="f2l-case-button selected"');
    controller.setF2lLibrary("basic");
    expect(render(controller)).not.toContain('class="f2l-case-button selected"');
  });

  it.each([["F2L 12", "#12"], ["AF2L 12", "#12"], ["AF2L 1a", "#1a"]])(
    "formats %s as %s", (name, expected) => expect(shortF2lCaseLabel(name)).toBe(expected),
  );
});


it("marks a personal algorithm only for its exact F2L library and position", async () => {
  const controller = new Controller(new CubeModel(kpuzzle)); controller.setArea("training");
  const built = buildF2lCatalogueTarget(kpuzzle, F2L_TRAINING_CATALOGUES.basic.cases[0], "FR");
  controller.trainingAlgorithmPreferences.set([createTrainingAlgorithmPreference(kpuzzle, catalogueIdentityForTarget(built.info)!, built.info.references[0].sourceAlg, "catalog")]);
  expect(render(controller)).toContain('aria-label="My algorithm saved"');
  await controller.selectF2lPosition("FL"); expect(render(controller)).not.toContain('aria-label="My algorithm saved"');
  controller.setF2lLibrary("advanced"); expect(render(controller)).not.toContain('aria-label="My algorithm saved"');
});
