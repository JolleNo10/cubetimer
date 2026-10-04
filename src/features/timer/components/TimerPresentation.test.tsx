import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Controller } from "../../../app/Controller";
import { ControllerContext } from "../../../app/useController";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import { TimerDisplay } from "./TimerDisplay";
import { ScramblePanel } from "./ScramblePanel";

const kpuzzle = await get3x3x3();
function display(controller: Controller, holding = false, holdReady = false) {
  return renderToStaticMarkup(<ControllerContext.Provider value={controller}>
    <TimerDisplay holding={holding} holdReady={holdReady} onPressStart={() => {}} onPressEnd={() => {}} />
  </ControllerContext.Provider>);
}

describe("Timer ownership-store presentation", () => {
  it.each([true, false].flatMap(holdToStart =>
    (["scrambling", "ready", "inspection", "solving", "finished"] as const).map(phase => ({ phase, holdToStart })),
  ))("matches manual interaction during $phase (holdToStart=$holdToStart)", ({ phase, holdToStart }) => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.settings.update(settings => ({ ...settings, holdToStart }));
    controller.timer.state.update(state => ({ ...state, phase }));
    const html = display(controller);
    expect(html).toContain(phase === "solving" || !holdToStart ? "Tap the timer or press" : "Hold the timer or");
    expect(html).toContain("<kbd>Space</kbd>");
    expect(html).toContain('touch-action:manipulation');
  });

  it("only prompts release after the shared hold is ready", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    expect(display(controller, true, false)).toContain("Keep holding to start");
    expect(display(controller, true, true)).toContain("Release to start");
  });

  it("renders inspection penalty, elapsed time and live move metrics from their owners", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.timer.state.update(state => ({ ...state, phase: "inspection", inspectionPenalty: "+2" }));
    controller.inspectionLeft.set(-100);
    expect(display(controller)).toContain('timer-value danger');
    expect(display(controller)).toContain("+2");
    controller.timer.state.update(state => ({ ...state, phase: "solving", liveMoves: ["R", "U"] }));
    controller.elapsed.set(1250);
    const solving = display(controller);
    expect(solving).toContain("1.25");
    expect(solving).toContain("moves <b>2</b>");
    controller.settings.update(settings => ({ ...settings, slowSolve: true }));
    expect(display(controller)).toContain('2<span class="timer-unit">moves</span>');
    controller.settings.update(settings => ({ ...settings, slowSolve: false, hideTimeWhileSolving: true }));
    expect(display(controller)).toContain('timer-value running" aria-live="off">solving');
  });

  it("renders scramble progress and recovery without a composed application snapshot", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.timer.state.update(state => ({ ...state, scramble: "R U", scrambleProgress: {
      index: 1, total: 2, partial: false, onTrack: false, done: false, nextMove: "U",
    }, recovery: { alg: "F'", resumeAt: 1 } }));
    const html = renderToStaticMarkup(<ControllerContext.Provider value={controller}><ScramblePanel /></ControllerContext.Provider>);
    expect(html).toContain("Off the scramble");
    expect(html).toContain("get back to move 1");
    expect(html).toContain("F&#x27;");
    controller.physical.state.update(state => ({ ...state, virtualCube: true }));
    expect(display(controller)).toContain("Cube is off the scramble");
  });
});
