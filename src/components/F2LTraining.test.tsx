import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControllerContext } from "../hooks/useController";
import { Controller } from "../state/controller";
import { CubeModel } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import { shortF2lCaseLabel } from "../cube/f2lTrainingCases";
import { F2LTraining } from "./F2LTraining";

const kpuzzle = await get3x3x3();

function render(controller: Controller) {
  return renderToStaticMarkup(
    <ControllerContext.Provider value={controller}>
      <F2LTraining state={controller.state.get()} />
    </ControllerContext.Provider>,
  );
}

describe("F2L training library presentation", () => {
  it("shows the Basic default and switches to all 54 grouped Advanced cards", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("f2l");
    const basic = render(controller);
    expect(basic).toContain('aria-label="F2L case library"');
    expect(basic).toContain('aria-pressed="true">Basic</button>');
    expect(basic).toContain("41 cases");
    expect(basic.match(/class="f2l-case-button/g)).toHaveLength(41);
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
  });

  it("highlights only the selected case in the active catalogue", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("f2l");
    controller.setF2lLibrary("advanced");
    await controller.setF2lMode("virtual");
    await controller.selectF2lCase("AF2L 3");
    expect(render(controller).match(/class="f2l-case-button selected"/g)).toHaveLength(1);
    expect(render(controller)).toContain("Advanced F2L");
    controller.state.update((state) => ({ ...state, f2lTraining: {
      ...state.f2lTraining,
      target: { ...state.f2lTraining.target!, origin: { kind: "solve-step", solveId: "exact", stepName: "F2L Slot 1", slot: "FL" } },
    } }));
    expect(render(controller)).not.toContain('class="f2l-case-button selected"');
    controller.setF2lLibrary("basic");
    expect(render(controller)).not.toContain('class="f2l-case-button selected"');
  });

  it.each([["F2L 12", "#12"], ["AF2L 12", "#12"], ["AF2L 1a", "#1a"]])(
    "formats %s as %s", (name, expected) => expect(shortF2lCaseLabel(name)).toBe(expected),
  );
});
