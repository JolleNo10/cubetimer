import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../../app/Controller";
import { ControllerContext } from "../../../app/useController";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import { createTrainingAttempt } from "../trainingHistory";
import type { TrainingFamily, TrainingResult } from "../TrainingRuntime";
import { Training } from "./Training";
import { TrainingPersonalPerformance, TrainingCaseMarker } from "./TrainingPerformance";
import { TrainingActions } from "./TrainingWorkspace";

const kpuzzle = await get3x3x3();
const result: TrainingResult = { moves: ["R", "U"], stm: 4, caseTimeMs: null, elapsedMs: 1400,
  recommendedStm: 3, preferredAlg: null, recommendedAlg: "R U", matchedReferenceRank: null, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: 1 };
afterEach(() => vi.restoreAllMocks());
async function fixture(family: TrainingFamily) {
  const controller = new Controller(new CubeModel(kpuzzle)); controller.setArea("training");
  await controller.setTrainingMode("virtual");
  if (family === "f2l") await controller.selectF2lCase("F2L 1");
  else await controller.selectLastLayerCase(family, family === "oll" ? "27" : "T");
  const target = controller.training.state.get().target!;
  controller.trainingAttempts.set(Array.from({ length: 4 }, (_, i) => ({
    ...createTrainingAttempt({ activity: "single", target, mode: "virtual", result }), id: String(i), createdAt: i,
    caseTimeMs: null, elapsedMs: i === 0 ? 1000 : 1400, stm: i === 0 ? 3 : 4,
  })));
  const render = (element = <Training />) => renderToStaticMarkup(<ControllerContext.Provider value={controller}>{element}</ControllerContext.Provider>);
  return { controller, target, render };
}

describe("personal Training presentation", () => {
  it.each(["f2l", "oll", "pll"] as const)("shows Random/Review, accessible card history, and selected %s performance", async family => {
    const { render } = await fixture(family);
    const html = render();
    expect(html).toContain("Random case"); expect(html).toContain("Review next");
    expect(html).toMatch(/aria-label="[^"]*, 4 attempts, needs review"/);
    expect(html).toContain('class="training-case-marker review"');
    expect(html).toContain("4 · Needs review");
    expect(html).toContain('aria-label="Personal Training performance"');
    expect(html).toContain("Best move span"); expect(html).toContain("Recent move span");
    expect(html).toContain("Best STM"); expect(html).toContain("Recent STM delta");
    expect(html).toContain("1.00"); expect(html).toContain("1.40"); expect(html).toContain("+1 STM");
    expect(html).toContain("Recent move spans:");
  });

  it("shows learning and practised marker text without badges for untouched cases", () => {
    const empty = { attempts: 0, bestCaseTimeMs: null, recentMedianCaseTimeMs: null, bestMoveSpanMs: null, recentMedianMoveSpanMs: null, bestStm: null,
      recentMedianDelta: null, lastPracticedAt: null, status: "new" as const, recentMoveSpansMs: [] };
    expect(renderToStaticMarkup(<TrainingCaseMarker stats={empty} />)).toBe("");
    expect(renderToStaticMarkup(<TrainingCaseMarker stats={{ ...empty, attempts: 1, status: "learning" }} />)).toContain("1 · Learning");
    expect(renderToStaticMarkup(<TrainingCaseMarker stats={{ ...empty, attempts: 3, status: "practiced" }} />)).toContain("3 · Practised");
  });

  it.each(["f2l", "oll", "pll"] as const)("offers Again and Next review for a completed catalogue %s", async family => {
    const { controller, render } = await fixture(family);
    controller.training.state.update(state => ({ ...state, result }));
    const html = render(<TrainingActions />);
    expect(html).toContain("Again"); expect(html).toContain("Next review"); expect(html).toContain("Clear case");
  });

  it.each(["f2l", "oll", "pll"] as const)("does not show catalogue mastery or Next review for exact %s practice", async family => {
    const { controller, target, render } = await fixture(family);
    controller.training.state.update(state => ({ ...state, result,
      target: target.family === "f2l"
        ? { ...target, origin: { kind: "solve-step", solveId: "source", stepName: "F2L Slot 1", slot: target.slot } }
        : { ...target, origin: { kind: "solve-step", solveId: "source", stepName: target.family === "oll" ? "OLL" : "PLL" } } }));
    expect(render(<TrainingPersonalPerformance />)).toBe("");
    const actions = render(<TrainingActions />);
    expect(actions).toContain("Again"); expect(actions).not.toContain("Next review");
    expect(render()).toContain("Review next");
  });

  it("separates F2L positions and Full/2-Look history in the cards", async () => {
    const { controller, render } = await fixture("f2l");
    await controller.selectF2lPosition("FL");
    const html = render();
    expect(html).not.toContain("4 attempts, needs review");
    expect(html).toContain("<dt>Attempts</dt><dd>0</dd>");
    const lastLayer = await fixture("oll");
    lastLayer.controller.settings.set({ ...lastLayer.controller.settings.get(), ollTrainingSet: "2look" });
    expect(lastLayer.render()).not.toContain('class="training-case-marker review"');
  });
});
