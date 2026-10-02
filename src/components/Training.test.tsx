import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControllerContext } from "../hooks/useController";
import { Controller } from "../state/controller";
import { CubeModel } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import { Header } from "./Header";
import { Training } from "./Training";

const kpuzzle = await get3x3x3();

function render(controller: Controller, element: React.ReactElement): string {
  return renderToStaticMarkup(
    <ControllerContext.Provider value={controller}>{element}</ControllerContext.Provider>,
  );
}

describe("Training area", () => {
  it("keeps the three families inside one Training screen", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, ready: true, area: "training" }));

    const f2l = render(controller, <Training state={controller.state.get()} />);
    expect(f2l).toContain("F2L cases");
    expect(f2l).toContain("OLL");
    expect(f2l).toContain("PLL");

    controller.setTrainingFamily("oll");
    const oll = render(controller, <Training state={controller.state.get()} />);
    expect(oll.match(/class="last-layer-case-button/g)).toHaveLength(57);
    expect(oll).toContain("dot");

    controller.setTrainingFamily("pll");
    const pll = render(controller, <Training state={controller.state.get()} />);
    expect(pll.match(/class="last-layer-case-button/g)).toHaveLength(21);
    expect(pll).toContain("Adj Swap");
    expect(pll).toContain("EPLL");
  });
});

describe("Header application navigation", () => {
  it("shows Timer, Training, and Statistics and gates Statistics during timing", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({
      ...state,
      ready: true,
      phase: "solving",
    }));
    const html = render(controller, <Header state={controller.state.get()} onOpenSettings={() => {}} onSelectArea={() => {}} />);
    expect(html).toContain(">Timer<");
    expect(html).toContain(">Training<");
    expect(html).toContain(">Statistics<");
    expect(html).toContain('aria-label="Application area"');
    expect(html).toMatch(/Statistics<\/button>/);
    expect(html).toContain("disabled");
  });
});
