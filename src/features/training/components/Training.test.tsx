import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLastLayerCatalogueTarget, lastLayerTrainingVariants } from "../../../cube/lastLayerTraining";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import { expandedAlgorithmMoves } from "../../../cube/frames";
import { ControllerContext } from "../../../app/useController";
import { Controller } from "../../../app/Controller";
import { Header } from "../../../app/components/Header";
import { Training } from "./Training";

const kpuzzle = await get3x3x3();
afterEach(() => vi.restoreAllMocks());

function render(controller: Controller, element: React.ReactElement): string {
  return renderToStaticMarkup(
    <ControllerContext.Provider value={controller}>{element}</ControllerContext.Provider>,
  );
}

describe("Training area", () => {
  it("shows the preserved attempt's algorithm and STM instead of the next target's recommendation or alternatives", async () => {
    const variants = lastLayerTrainingVariants(kpuzzle, "pll", "Headlights", "2look");
    const targets = variants.map((variant) => buildLastLayerCatalogueTarget(kpuzzle, "pll", "Headlights", 0, "2look", variant.id));
    const first = targets[0].info.references[0];
    const nextIndex = targets.findIndex((target) => target.info.references[0].alg !== first.alg && target.info.references[0].stm !== first.stm);
    expect(nextIndex).toBeGreaterThan(0);
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.settings.set({ ...controller.settings.get(), pllTrainingSet: "2look" });
    controller.setTrainingFamily("pll");
    await controller.setTrainingMode("virtual");
    vi.spyOn(Math, "random").mockReturnValueOnce((nextIndex + 0.5) / variants.length).mockReturnValueOnce(0);
    await controller.selectLastLayerCase("pll", "Headlights");
    const ready = { ...controller.snapshot(), training: controller.training.state.get() };
    const next = ready.training.target;
    if (!next || next.family === "f2l") throw new Error("Last-layer target missing");
    // Give the next target an alternative to exercise the preserved-result guard.
    const target = { ...next, references: [...next.references, { ...next.references[0], rank: 2, alg: "R U2 R'" }] };
    const result = { moves: [], stm: first.stm, recommendedAlg: first.alg, recommendedStm: first.stm, matchedReferenceRank: 1, delta: 0, caseTimeMs: null, elapsedMs: 1000 };
    const draw = (preserved: typeof result | null) => {
      controller.training.state.set({ ...ready.training, target, result: preserved });
      return render(controller, <Training />);
    };
    const html = draw(result);
    const recommendation = html.split('class="f2l-reference"')[1].split('class="f2l-result-card"')[0];
    const tokens = [...recommendation.matchAll(/<span class="move-sequence-token[^\"]*"[^>]*>(.*?)<\/span>/g)].map((match) => match[1].replaceAll("&#x27;", "'"));
    expect(tokens).toEqual(expandedAlgorithmMoves(first.alg));
    expect(tokens).not.toEqual(expandedAlgorithmMoves(next.references[0].alg));
    expect(recommendation).toContain(`<strong>${first.stm} STM</strong>`);
    expect(recommendation).not.toContain(`<strong>${next.references[0].stm} STM</strong>`);
    expect(html).not.toContain("alternatives");
    const resumed = draw(null);
    expect(resumed).toContain(`<strong>${next.references[0].stm} STM</strong>`);
    expect(resumed).toContain("Show 1 alternatives");
    expect(resumed).toContain('aria-current="step"');
  });

  it.each(["f2l", "oll", "pll"] as const)("shows shared %s guidance only for a ready/solving reference", async (family) => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("training");
    controller.setTrainingFamily(family);
    await controller.setTrainingMode("virtual");
    if (family === "f2l") await controller.selectF2lCase("F2L 1");
    else await controller.selectLastLayerCase(family, family === "oll" ? "27" : "T");
    const ready = { ...controller.snapshot(), training: controller.training.state.get() };
    const draw = (state: typeof ready) => {
      controller.training.state.set(state.training);
      controller.settings.set(state.settings);
      return render(controller, <Training />);
    };
    const html = draw(ready);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('cube-move-guide');
    expect(html).toContain(`Move 1 / ${ready.training.guide!.moves.length}`);
    if (ready.training.target!.references.length > 1) expect(html).toContain("alternatives");
    const preparing = { ...ready, training: { ...ready.training, phase: "preparing" as const } };
    expect(draw(preparing)).not.toContain("cube-move-guide");
    expect(draw(preparing)).not.toContain('aria-current="step"');
    expect(draw(preparing)).toContain('aria-label="Recommended algorithm"');
    expect(draw(preparing)).not.toMatch(/Move \d+ \/|Guide complete/);
    const solving = {
      ...ready, training: {
        ...ready.training, phase: "solving" as const,
        guide: { ...ready.training.guide!, confirmed: 1, currentMove: null }
      }
    };
    expect(draw(solving)).toContain('move-sequence-token completed');
    expect(draw(solving)).toContain('aria-current="step"');
    expect(draw(solving)).toContain(`Move 2 / ${ready.training.guide!.moves.length}`);
    expect(draw({ ...ready, settings: { ...ready.settings, visualization: "2D" } })).not.toContain("cube-move-guide");
    expect(draw({ ...ready, settings: { ...ready.settings, visualization: "2D" } })).toContain('aria-current="step"');
    const result = { moves: [], stm: 1, recommendedStm: 1, recommendedAlg: ready.training.target!.references[0].alg, matchedReferenceRank: null, delta: 0, caseTimeMs: null, elapsedMs: 1 };
    expect(draw({ ...ready, training: { ...ready.training, phase: "result", result } })).not.toContain("cube-move-guide");
    for (const phase of ["result", "ready"] as const) {
      const reviewed = draw({ ...ready, training: { ...ready.training, phase, result } });
      expect(reviewed).toContain('aria-label="Recommended algorithm"');
      expect(reviewed).not.toContain('aria-current="step"');
      expect(reviewed).not.toMatch(/Move \d+ \/|Guide complete/);
    }
    // Virtual automatic reload preserves its previous result while ready.
    expect(draw({ ...ready, training: { ...ready.training, result } })).not.toContain("cube-move-guide");
    expect(draw({ ...ready, training: { ...ready.training, target: { ...ready.training.target!, references: [] } } })).not.toContain("cube-move-guide");
  });

  it.each([
    ["oll", 10, "1: Edges", "2: Corners", ["Dot Shape", "I-Shape", "L-Shape", "Antisune", "H", "L", "Pi", "Sune", "T", "U"]],
    ["pll", 6, "1: Corners", "2: Edges", ["Diagonal", "Headlights", "H", "Ua", "Ub", "Z"]],
  ] as const)("renders the named 2-Look %s library without Full labels", (family, count, firstGroup, secondGroup, names) => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.settings.set({ ...controller.settings.get(), ollTrainingSet: "2look", pllTrainingSet: "2look" });
    controller.setTrainingFamily(family);
    const html = render(controller, <Training />);
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
    controller.settings.set({ ...controller.settings.get(), pllTrainingSet: "2look" });
    controller.setTrainingFamily("pll");
    await controller.setTrainingMode("virtual");
    await controller.selectLastLayerCase("pll", "Headlights");
    expect(render(controller, <Training />)).toContain("2-Look PLL Headlights");
  });

  it("identifies historical Full targets even inside a 2-Look library", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setTrainingFamily("pll");
    await controller.setTrainingMode("virtual");
    await controller.selectLastLayerCase("pll", "H");
    // Exact historical targets can be Full while Settings select 2-Look.
    controller.settings.set({ ...controller.settings.get(), pllTrainingSet: "2look" });
    const html = render(controller, <Training />);
    expect(html).toContain("<strong>PLL H</strong>");
    expect(html).not.toContain('last-layer-case-button selected');
  });

  it("keeps the three families inside one Training screen", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, ready: true, area: "training" }));

    const f2l = render(controller, <Training />);
    expect(f2l).toContain("F2L cases");
    expect(f2l).toContain("OLL");
    expect(f2l).toContain("PLL");

    controller.setTrainingFamily("oll");
    const oll = render(controller, <Training />);
    expect(oll.match(/class="last-layer-case-button/g)).toHaveLength(57);
    expect(oll).toContain("dot");

    controller.setTrainingFamily("pll");
    const pll = render(controller, <Training />);
    expect(pll.match(/class="last-layer-case-button/g)).toHaveLength(21);
    expect(pll).toContain("Adj Swap");
    expect(pll).toContain("EPLL");
  });
});

describe("Header application navigation", () => {
  it("shows Timer, Training, and Statistics and gates Statistics during timing", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, ready: true }));
    controller.timer.state.update((state) => ({ ...state, phase: "solving" }));
    const html = render(controller, <Header onOpenSettings={() => { }} onSelectArea={() => { }} />);
    expect(html).toContain(">Timer<");
    expect(html).toContain(">Training<");
    expect(html).toContain(">Statistics<");
    expect(html).toContain('aria-label="Application area"');
    expect(html).toContain('class="area-switch header-area-switch"');
    expect(html).toContain('class="header-context"');
    expect(html).toContain('class="header-status"');
    for (const label of ["Event", "Session", "Rename session", "Delete session", "Settings"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("slow solve");
    expect(html).toContain('class="header-device-name"');
    expect(html).toMatch(/Statistics<\/button>/);
    expect(html).toContain("disabled");
  });
});
