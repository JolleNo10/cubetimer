import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Controller } from "../../app/Controller";
import { ControllerContext } from "../../app/useController";
import { ConnectionPanel } from "./ConnectionPanel";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["ready", "ready", false],
  ["inspection", "ready", true],
  ["solving", "ready", true],
  ["ready", "solving", true],
] as const)("Mark solved reflects Timer %s and Training %s safety", (timerPhase, trainingPhase, disabled) => {
  vi.stubGlobal("navigator", { bluetooth: {} });
  const controller = new Controller();
  controller.physical.state.update(state => ({ ...state, cubeStatus: "connected" }));
  controller.timer.state.update(state => ({ ...state, phase: timerPhase }));
  controller.training.state.update(state => ({ ...state, phase: trainingPhase }));
  const html = renderToStaticMarkup(<ControllerContext.Provider value={controller}>
    <ConnectionPanel open onClose={() => {}} />
  </ControllerContext.Provider>);
  const button = html.match(/<button[^>]*>Mark solved<\/button>/)![0];
  expect(button.includes("disabled")).toBe(disabled);
});
