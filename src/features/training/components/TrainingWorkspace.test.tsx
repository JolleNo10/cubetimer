import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import { ControllerContext } from "../../../app/useController";
import { Controller } from "../../../app/Controller";
import type { TrainingResult, TrainingState } from "../TrainingRuntime";
import { type MoveGuide } from "../../../cube/moveGuide";
import { TrainingActions, TrainingAttemptResult, TrainingCubeStage, TrainingReferences, TrainingSetupPanel, TrainingWorkspace } from "./TrainingWorkspace";

vi.mock("../../../shared/ui/CubeView", () => ({ CubeView: (props: { displaySource: string; live: boolean; displayFacelets: string; physicalSyncAvailable: boolean; displayRevision: string | number; staticDisplay: boolean; guideMove?: MoveGuide | null }) =>
  <div data-source={props.displaySource} data-live={props.live} data-facelets={props.displayFacelets} data-sync={props.physicalSyncAvailable} data-revision={props.displayRevision} data-static={props.staticDisplay}
    data-guide-token={props.guideMove?.token} data-guide-axis={props.guideMove?.axis} /> }));
const kpuzzle = await get3x3x3();
function render(controller: Controller, element: React.ReactElement) {
  return renderToStaticMarkup(<ControllerContext.Provider value={controller}>{element}</ControllerContext.Provider>);
}
async function selected() {
  const controller = new Controller(new CubeModel(kpuzzle));
  controller.setArea("training");
  await controller.setTrainingMode("virtual");
  await controller.selectF2lCase("F2L 1");
  return controller;
}
const result: TrainingResult = { moves: ["R", "U", "R'"], stm: 3, elapsedMs: 1250, recommendedStm: 3,
  recommendedAlg: "R U R'", matchedReferenceRank: 1, delta: 0 };

describe("shared Training presentation", () => {
  it("places the case library before connection controls in DOM and focus order", async () => {
    const controller = await selected();
    const html = render(controller, <TrainingWorkspace library={<button>Choose a Training case</button>} details={<div />} emptyMessage="Choose a case" />);
    expect(html).toContain("Smart cube");
    expect(html.indexOf("Choose a Training case")).toBeLessThan(html.indexOf('class="panel connection-panel"'));
  });

  it("uses live state by default, and binds each preview move to its checkpoint and reset key", async () => {
    const controller = await selected();
    const training = controller.training.state.get(), guide = training.guide!;
    const live = render(controller, <TrainingCubeStage />);
    expect(live).toContain(`data-facelets="${training.displayFacelets}"`);
    expect(live).toContain(`data-guide-axis="${guide.currentMove!.axis}"`);
    expect(live).toContain(`data-revision="${training.displayRevision}:live"`);
    expect(live).toContain('data-static="false"');
    for (const index of [1, 2]) {
      const preview = { index, move: guide.guideMoves[index], facelets: guide.checkpointFacelets[index] };
      const html = render(controller, <TrainingCubeStage preview={preview} />);
      expect(html).toContain(`data-guide-token="${preview.move.token.replaceAll("'", "&#x27;")}"`);
      expect(html).toContain(`data-guide-axis="${preview.move.axis}"`);
      expect(html).toContain(`data-facelets="${preview.facelets}"`);
      expect(html).toContain(`data-revision="${training.displayRevision}:preview:${index}"`);
      expect(html).toContain('data-static="true"');
    }
    expect(guide.checkpointFacelets[2]).not.toBe(guide.checkpointFacelets[1]);
    expect(render(controller, <TrainingCubeStage />)).toBe(live);
    controller.training.state.update(state => ({ ...state, displayRevision: state.displayRevision + 1 }));
    expect(render(controller, <TrainingCubeStage />)).toContain(`data-revision="${training.displayRevision + 1}:live"`);
  });

  it.each(["preparing", "result", "ready"] as const)("cannot revive an inactive guide or hypothetical cube with a preview (%s)", async phase => {
    const controller = await selected();
    const guide = controller.training.state.get().guide!;
    const preview = { index: 1, move: guide.guideMoves[1], facelets: guide.checkpointFacelets[1] };
    controller.training.state.update(state => ({ ...state, phase, result: phase === "ready" ? result : null }));
    const html = render(controller, <TrainingCubeStage preview={preview} />);
    expect(html).not.toContain("data-guide-token");
    expect(html).toContain('data-static="false"');
    expect(html).toContain(`data-facelets="${controller.training.state.get().displayFacelets}"`);
  });

  it.each([
    ["setup", "ready", "Ready"], ["virtual", "ready", "Ready"],
    ["setup", "solving", "Solving"], ["virtual", "solving", "Solving"],
    ["setup", "result", "Complete"], ["virtual", "result", "Complete"],
  ] as const)("renders %s %s setup status", async (mode, phase, label) => {
    const controller = await selected();
    controller.training.state.update(state => ({ ...state, mode, phase, liveMoves: ["R", "U"] }));
    const html = render(controller, <TrainingSetupPanel />);
    expect(html).toContain(`<strong>${label}</strong>`);
    if (phase === "solving") expect(html).toContain("2 turns");
    expect(html).toContain('aria-label="Training mode"');
  });

  it("renders setup progress, off-track recovery and re-read action", async () => {
    const controller = await selected();
    const progress = { index: 1, total: 3, partial: false, onTrack: true, done: false, nextMove: "U" };
    controller.training.state.update(state => ({ ...state, mode: "setup", phase: "preparing", setup: "R U R'", setupProgress: progress }));
    const tracked = render(controller, <TrainingSetupPanel />);
    expect(tracked).toContain('class="scramble-move done">R</span>');
    expect(tracked).toContain('class="scramble-move next">U</span>');
    controller.training.state.update(state => ({ ...state, setupProgress: { ...progress, onTrack: false }, recoveryPending: true }));
    expect(render(controller, <TrainingSetupPanel />)).toContain("Working out a way back");
    controller.training.state.update(state => ({ ...state, recoveryPending: false, recovery: { alg: "F U F'", resumeAt: 1 } }));
    const offTrack = render(controller, <TrainingSetupPanel />);
    expect(offTrack).toContain("F U F&#x27;");
    expect(offTrack).toContain("Re-read cube");
    expect(offTrack).not.toContain('class="scramble-move next"');
  });

  it.each(["setup", "virtual"] as const)("uses the %s cube display source without losing physical sync", async mode => {
    const controller = await selected();
    controller.physical.state.update((state) => ({ ...state, cubeStatus: "connected" }));
    controller.training.state.update(state => ({ ...state, mode, displayFacelets: "target-facelets" }));
    const html = render(controller, <TrainingCubeStage />);
    expect(html).toContain(`data-source="${mode === "setup" ? "physical" : "virtual"}"`);
    expect(html).toContain('data-live="true"');
    expect(html).toContain('data-facelets="target-facelets"');
    expect(html).toContain('data-sync="true"');
  });

  it.each([
    [1, 0, "Recommended solution", "Same STM as recommended"],
    [2, 2, "Known alternative #2", "+2 STM vs recommended"],
    [null, -1, "Valid custom solution", "1 STM fewer than recommended"],
  ] as const)("preserves result classification for reference %s", (rank, delta, classification, difference) => {
    const html = renderToStaticMarkup(<TrainingAttemptResult result={{ ...result, matchedReferenceRank: rank, delta }} phase="result" liveMoveCount={0} elapsed={0} />);
    expect(html).toContain(classification);
    expect(html).toContain(difference);
    expect(html).toContain("R U R&#x27;");
    expect(html).toContain("elapsed 1.25");
  });

  it.each(["f2l", "oll", "pll"] as const)("shows shared result actions for %s", async family => {
    const controller = await selected();
    controller.training.state.update((state): TrainingState => ({ ...state, family, phase: "result", result }));
    const html = render(controller, <TrainingActions />);
    expect(html).toContain("Again");
    expect(html).toContain("Clear case");
  });
});

describe("family result presentation", () => {
  it.each(["oll", "pll"] as const)("keeps %s virtual reload Complete while ready with a previous result", async family => {
    const controller = await selected();
    controller.training.state.update(state => ({ ...state, family, phase: "ready", result }));
    const html = render(controller, <TrainingSetupPanel />);
    expect(html).toContain("<strong>Complete</strong>");
    expect(html).not.toContain("<strong>Ready</strong>");
  });

  it("keeps F2L alternatives available when showing a completed attempt", async () => {
    const controller = await selected();
    const target = controller.training.state.get().target!;
    expect(target.references.length).toBeGreaterThan(1);
    controller.training.state.update(state => ({ ...state, phase: "result", result }));
    const html = render(controller, <TrainingReferences />);
    expect(html).toContain(`Show ${target.references.length - 1} alternatives`);
    expect(html).not.toContain('aria-current="step"');
  });
});
