import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Controller } from "../../../app/Controller";
import { ControllerContext, useSessionState } from "../../../app/useController";
import type { Solve } from "../../../app/types";
import { StatsPanel } from "./StatsPanel";
import { SolveList } from "../../history/components/SolveList";
import { SolveResult } from "../../history/components/SolveResult";

function History() {
  const { solves, lastSolve } = useSessionState();
  return <><StatsPanel solves={solves} /><SolveList solves={solves} selectedId={null} onSelect={() => {}} />
    {lastSolve ? <SolveResult solve={lastSolve} solves={solves} onContinue={() => {}} onReplay={() => {}} /> : null}</>;
}

function setup() {
  const controller = new Controller();
  const solves: Solve[] = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, sessionId: "A", createdAt: index,
    rawMs: index === 5 ? 40000 : 10000, penalty: "none", moves: [], scramble: "R U", source: "keyboard" }));
  controller.sessions.update(state => ({ ...state, solves, lastSolve: solves[5] }));
  return { controller, solves, render: () => renderToStaticMarkup(<ControllerContext.Provider value={controller}><History /></ControllerContext.Provider>) };
}

describe("threshold settings across saved history and current results", () => {
  it("keeps a flagged solve visible while excluding it from the displayed statistics", () => {
    const { controller, solves, render } = setup();
    const html = render();
    expect(html).toContain("5 counted"); expect(html).toContain("auto slow - not counted"); expect(html).toContain("40.00");
    expect(controller.sessions.get().solves).toEqual(solves);
    expect(controller.sessions.get().lastSolve?.penalty).toBe("none");
  });
  it("restores the same historical solve when the rule is disabled", () => {
    const { controller, render } = setup();
    expect(render()).toContain("5 counted");
    controller.settings.update(settings => ({ ...settings, slowSolveHandling: "off" }));
    expect(render()).toContain("6 counted"); expect(render()).not.toContain("auto slow");
  });
  it("shows automatic DNF separately from the saved manual penalty", () => {
    const { controller, render } = setup();
    controller.settings.update(settings => ({ ...settings, slowSolveHandling: "dnf" }));
    const html = render();
    expect(html).toContain("6 counted"); expect(html).toContain("DNF(40.00)"); expect(html).toContain("auto slow - counts as DNF");
    expect(controller.sessions.get().lastSolve?.penalty).toBe("none");
  });
});
