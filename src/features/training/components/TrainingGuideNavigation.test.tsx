import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../../app/Controller";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import { buildTrainingGuide, trainingGuideProgress, type TrainingGuideMove } from "../../../cube/training";
import { IDENTITY } from "../../../cube/orientation";
import { TrainingWorkspace } from "./TrainingWorkspace";

// Exercise real presentation callbacks and controlled state without a browser.
// Only the workspace's state persists; effects are omitted deliberately so the
// context guard is also tested before its reset effect can run.
const hooks = vi.hoisted(() => ({
  controller: null as Controller | null, workspace: false, selection: null as unknown,
  cubeMove: null as TrainingGuideMove | null | undefined,
  cubeFacelets: "", cubeRevision: "", cubeStatic: false,
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (make: () => unknown) => make(), useEffect: () => {},
  useState: (initial: unknown) => hooks.workspace
    ? [hooks.selection, (value: unknown) => { hooks.selection = value; }]
    : [initial, () => {}],
}));
vi.mock("../../../app/useController", () => ({
  useController: () => hooks.controller,
  useTrainingState: () => hooks.controller!.training.state.get(),
  useSettings: () => hooks.controller!.settings.get(),
  useStore: (store: { get(): unknown }) => store.get(),
  useStoreValue: (store: { get(): unknown }, select: (value: unknown) => unknown) => select(store.get()),
}));
vi.mock("../../../shared/ui/ConnectionPanel", () => ({ ConnectionPanel: () => null }));
vi.mock("../../../shared/ui/CubeView", () => ({ CubeView: (props: { guideMove?: TrainingGuideMove | null; displayFacelets: string; displayRevision: string; staticDisplay: boolean }) => {
  hooks.cubeMove = props.guideMove;
  hooks.cubeFacelets = props.displayFacelets;
  hooks.cubeRevision = props.displayRevision;
  hooks.cubeStatic = props.staticDisplay;
  return <div />;
} }));

const kpuzzle = await get3x3x3();
type ButtonProps = { children: string; onClick(): void; disabled?: boolean; "aria-label"?: string; "aria-current"?: string; className: string };
beforeEach(() => {
  hooks.selection = null;
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const controller = new Controller(new CubeModel(kpuzzle));
  controller.setArea("training");
  await controller.setTrainingMode("virtual");
  await controller.selectF2lCase("F2L 1");
  const state = controller.training.state.get();
  if (state.target?.family !== "f2l") throw new Error("Missing F2L target");
  const target = { ...state.target, references: [{ ...state.target.references[0], alg: "y R U", stm: 3 }] };
  const guide = buildTrainingGuide(controller.pattern!, {
    trainingRotation: { orientation: IDENTITY, tokens: [] }, references: target.references,
  })!;
  controller.training.state.update(state => ({ ...state, target, guide: trainingGuideProgress(guide) }));
  hooks.controller = controller;
  function render() {
    const buttons: ButtonProps[] = [];
    function visit(value: unknown): void {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const element = value as ReactElement<Record<string, unknown>>;
      if (typeof element.type === "function") {
        hooks.workspace = element.type === TrainingWorkspace;
        const output = (element.type as (props: unknown) => unknown)(element.props);
        hooks.workspace = false;
        visit(output);
      } else {
        if (element.type === "button") buttons.push(element.props as ButtonProps);
        visit(element.props.children);
      }
    }
    visit(<TrainingWorkspace library={<div />} details={<div />} emptyMessage="Choose a case" />);
    return {
      button: (label: string) => {
        const button = buttons.find(props => props["aria-label"] === label || props.children === label);
        if (!button) throw new Error(`Missing button: ${label}`);
        return button;
      },
      hasButton: (label: string) => buttons.some(props => props.children === label),
    };
  }
  return { controller, guide, render };
}

describe("manual Training instruction preview", () => {
  it("browses exact remapped moves with tokens and Previous/Next, then follows current without changing runtime facts", async () => {
    const { controller, guide, render } = await fixture();
    const training = controller.training.state.get(), physical = controller.pattern;
    const elapsed = controller.elapsed.get();
    let view = render();
    expect(hooks.cubeMove).toBe(training.guide!.currentMove);
    expect(hooks.cubeFacelets).toBe(training.displayFacelets);
    expect(hooks.cubeStatic).toBe(false);
    expect(hooks.cubeRevision).toBe(`${training.displayRevision}:live`);
    expect(view.button("Previous").disabled).toBe(true);
    expect(view.hasButton("Follow current")).toBe(false);
    view.button("View move 2: R").onClick();
    view = render();
    expect(hooks.cubeMove).toBe(guide.guideMoves[1]);
    expect(hooks.cubeFacelets).toBe(guide.checkpointFacelets[1]);
    expect(hooks.cubeStatic).toBe(true);
    expect(hooks.cubeRevision).toBe(`${training.displayRevision}:preview:1`);
    expect(hooks.cubeMove!.axis).toBe("z"); // R remapped by the preceding y.
    expect(view.button("View move 1: y")["aria-current"]).toBe("step");
    expect(view.button("View move 2: R")["aria-current"]).toBeUndefined();
    expect(view.button("View move 2: R").className).toContain("previewed");
    view.button("Next").onClick();
    view = render();
    expect(hooks.cubeMove).toBe(guide.guideMoves[2]);
    expect(hooks.cubeFacelets).toBe(guide.checkpointFacelets[2]);
    expect(hooks.cubeRevision).toBe(`${training.displayRevision}:preview:2`);
    expect(view.button("Next").disabled).toBe(true);
    view.button("Previous").onClick();
    view = render();
    expect(hooks.cubeMove).toBe(guide.guideMoves[1]);
    view.button("Follow current").onClick();
    view = render();
    expect(hooks.cubeMove).toBe(training.guide!.currentMove);
    expect(hooks.cubeFacelets).toBe(training.displayFacelets);
    expect(hooks.cubeStatic).toBe(false);
    expect(hooks.cubeRevision).toBe(`${training.displayRevision}:live`);
    expect(view.hasButton("Follow current")).toBe(false);
    expect(controller.training.state.get()).toBe(training);
    expect(controller.pattern).toBe(physical);
    expect(controller.training.state.get().displayFacelets).toBe(training.displayFacelets);
    expect(controller.elapsed.get()).toBe(elapsed);
  });

  it.each(["token", "Previous", "Next"])("collapses %s selection of the actual current instruction back to live state", async action => {
    const { controller, guide, render } = await fixture();
    controller.training.state.update(state => ({ ...state, guide: trainingGuideProgress(guide, 1) }));
    let view = render();
    view.button(action === "Next" ? "View move 1: y" : "View move 3: U").onClick();
    view = render();
    expect(hooks.cubeStatic).toBe(true);
    view.button(action === "token" ? "View move 2: R" : action).onClick();
    view = render();
    expect(hooks.selection).toBeNull();
    expect(view.hasButton("Follow current")).toBe(false);
    expect(hooks.cubeStatic).toBe(false);
    expect(hooks.cubeFacelets).toBe(controller.training.state.get().displayFacelets);
    expect(hooks.cubeMove).toBe(guide.guideMoves[1]);
    expect(hooks.cubeRevision).toBe(`${controller.training.state.get().displayRevision}:live`);
  });

  it("keeps a preview through a real deviating turn without changing confirmation", async () => {
    const { controller, render } = await fixture();
    render().button("View move 3: U").onClick();
    render();
    const guide = controller.training.state.get().guide;
    controller.injectMove("B");
    expect(controller.training.state.get().guide).toBe(guide);
    expect(render().hasButton("Follow current")).toBe(true);
    expect(hooks.cubeStatic).toBe(true);
  });

  it("resumes automatic display as soon as confirmed progress advances", async () => {
    const { controller, guide, render } = await fixture();
    render().button("View move 3: U").onClick(); render();
    expect(hooks.cubeMove).toBe(guide.guideMoves[2]);
    controller.training.state.update(state => ({ ...state, guide: trainingGuideProgress(guide, 1) }));
    const view = render();
    expect(hooks.cubeMove).toBe(guide.guideMoves[1]);
    expect(hooks.cubeFacelets).toBe(controller.training.state.get().displayFacelets);
    expect(hooks.cubeStatic).toBe(false);
    expect(view.hasButton("Follow current")).toBe(false);
  });

  it.each(["target", "guide"] as const)("does not carry preview into a changed %s", async context => {
    const { controller, guide, render } = await fixture();
    render().button("View move 3: U").onClick(); render();
    controller.training.state.update(state => context === "target"
      ? { ...state, target: { ...state.target! } }
      : { ...state, guide: { ...trainingGuideProgress(guide), guideMoves: [...guide.guideMoves] } });
    expect(render().hasButton("Follow current")).toBe(false);
    expect(hooks.cubeMove).toBe(guide.guideMoves[0]);
  });
});
