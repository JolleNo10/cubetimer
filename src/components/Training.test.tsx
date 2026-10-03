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
  it.each(["f2l", "oll", "pll"] as const)("shows shared %s guidance only for a ready/solving reference", async (family) => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("training");
    controller.setTrainingFamily(family);
    await controller.setTrainingMode("virtual");
    if (family === "f2l") await controller.selectF2lCase("F2L 1");
    else await controller.selectLastLayerCase(family, family === "oll" ? "27" : "T");
    const ready = controller.state.get();
    const draw = (state: typeof ready) => render(controller, <Training state={state} />);
    const html = draw(ready);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('cube-move-guide');
    expect(html).toContain(`Move 1 / ${ready.training.guide!.moves.length}`);
    if (ready.training.target!.references.length > 1) expect(html).toContain("alternatives");
    const preparing = { ...ready, training: { ...ready.training, phase: "preparing" as const } };
    expect(draw(preparing)).not.toContain("cube-move-guide");
    expect(draw(preparing)).not.toContain('aria-current="step"');
    const solving = { ...ready, training: { ...ready.training, phase: "solving" as const,
      guide: { ...ready.training.guide!, confirmed: 1, currentMove: null } } };
    expect(draw(solving)).toContain('training-algorithm-token completed');
    expect(draw(solving)).toContain('aria-current="step"');
    expect(draw({ ...ready, settings: { ...ready.settings, visualization: "2D" } })).not.toContain("cube-move-guide");
    expect(draw({ ...ready, settings: { ...ready.settings, visualization: "2D" } })).toContain('aria-current="step"');
    const result = { moves: [], stm: 1, recommendedStm: 1, matchedReferenceRank: null, delta: 0, elapsedMs: 1 };
    expect(draw({ ...ready, training: { ...ready.training, phase: "result", result } })).not.toContain("cube-move-guide");
    // Virtual automatic reload preserves its previous result while ready.
    expect(draw({ ...ready, training: { ...ready.training, result } })).not.toContain("cube-move-guide");
    expect(draw({ ...ready, training: { ...ready.training, target: { ...ready.training.target!, references: [] } } })).not.toContain("cube-move-guide");
  });

  it.each([
    ["oll", 10, "1: Edges", "2: Corners", ["Dot Shape", "I-Shape", "L-Shape", "Antisune", "H", "L", "Pi", "Sune", "T", "U"]],
    ["pll", 6, "1: Corners", "2: Edges", ["Diagonal", "Headlights", "H", "Ua", "Ub", "Z"]],
  ] as const)("renders the named 2-Look %s library without Full labels", (family, count, firstGroup, secondGroup, names) => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, settings: { ...state.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" } }));
    controller.setTrainingFamily(family);
    const html = render(controller, <Training state={controller.state.get()} />);
    expect(html.match(/class="last-layer-case-button/g)).toHaveLength(count);
    expect(html).toContain(`2-Look ${family.toUpperCase()} cases`);
    expect(html).toContain(`${count} cases`);
    expect(html).toContain(firstGroup);
    expect(html).toContain(secondGroup);
    for (const name of names) expect(html).toContain(`aria-label="${name}"`);
    expect(html).not.toMatch(/<span>#\d+<\/span>/);
    expect(html).not.toContain(family === "oll" ? "57 cases" : "21 cases");
  });

  it("shows a 2-Look target's friendly name and recorded set", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, settings: { ...state.settings, pllTrainingSet: "2look" } }));
    controller.setTrainingFamily("pll");
    await controller.setTrainingMode("virtual");
    await controller.selectLastLayerCase("pll", "Headlights");
    expect(render(controller, <Training state={controller.state.get()} />)).toContain("2-Look PLL Headlights");
  });

  it("identifies historical Full targets even inside a 2-Look library", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setTrainingFamily("pll");
    await controller.setTrainingMode("virtual");
    await controller.selectLastLayerCase("pll", "H");
    // Exact historical targets can be Full while Settings select 2-Look.
    controller.state.update((state) => ({ ...state, settings: { ...state.settings, pllTrainingSet: "2look" } }));
    const html = render(controller, <Training state={controller.state.get()} />);
    expect(html).toContain("<strong>PLL H</strong>");
    expect(html).not.toContain('last-layer-case-button selected');
  });

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
