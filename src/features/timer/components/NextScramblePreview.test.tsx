import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Controller } from "../../../app/Controller";
import { ControllerContext } from "../../../app/useController";
import { NextScramblePreview } from "./NextScramblePreview";

function render(controller: Controller) {
  return renderToStaticMarkup(<ControllerContext.Provider value={controller}>
    <NextScramblePreview onContinue={() => {}} />
  </ControllerContext.Provider>);
}

describe("Next scramble on the result screen", () => {
  it("shows the Timer's waiting scramble and how to begin it from the keyboard", () => {
    const controller = new Controller();
    controller.timer.state.update(state => ({ ...state, phase: "scrambling", scramble: "R U F' D2" }));
    const html = render(controller);
    expect(html).toContain("NEXT SCRAMBLE");
    expect(html).toContain("R U F&#x27; D2");
    expect(html).toContain(">Next solve</button>");
    expect(html).toContain("or hold Space");
  });

  it("tells a cube user to start turning", () => {
    const controller = new Controller();
    controller.physical.state.update(state => ({ ...state, virtualCube: true }));
    expect(render(controller)).toContain("or start turning the cube");
  });

  it("explains a missing scramble while generating and after the Training review", () => {
    const controller = new Controller();
    controller.timer.state.update(state => ({ ...state, phase: "scrambling", scramble: "" }));
    expect(render(controller)).toContain("Generating a scramble…");
    controller.timer.state.update(state => ({ ...state, phase: "finished", scramble: "" }));
    expect(render(controller)).toContain("A new scramble is made when you continue.");
  });
});
