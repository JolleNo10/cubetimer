import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { analyseSolve, type SolveAnalysis } from "../../../../cube/analysis";
import { get3x3x3 } from "../../../../cube/puzzle";
import { Controller } from "../../../../app/Controller";
import { ControllerContext } from "../../../../app/useController";
import type { ResultChart, ResultScatter, Solve } from "../../../../app/types";
import { caseSpread, compareSolveToHistory } from "../../../statistics/state/stats";
import { ResultCharts } from "./ResultCharts";
import { CaseSpread } from "./CaseSpread";
import { SolveDial } from "./SolveDial";
import { StepTrends } from "./StepTrends";
import { DetailedStepBreakdown } from "../StepBreakdown";
import { StepScatter } from "./StepScatter";

const kpuzzle = await get3x3x3();
const extractions = ["F U F' U'", "L U L' U'", "B U B' U'", "R U R' U'"];
const oll = "R U R' U R U2' R'";
const pll = "R U R' U' R' F R2 U' R' U' R U R' F'";
const scrambled = kpuzzle.defaultPattern()
  .applyAlg(new Alg(pll).invert()).applyAlg(new Alg(oll).invert()).applyAlg(new Alg(extractions.join(" ")))
  .applyAlg(new Alg("D R2 D' R2"));
const solution = "R2 D R2 D' " + [...extractions].reverse().map((e) => new Alg(e).invert().toString()).join(" ") + ` ${oll} ${pll}`;

function solve(id: string, createdAt: number, gap: number): Solve {
  const moves = Array.from(new Alg(solution).expand().childAlgNodes())
    .map((node, i) => ({ move: node.toString(), t: (i + 1) * gap + (i % 5 === 0 ? 400 : 0) }));
  return {
    id, sessionId: "s", createdAt, rawMs: moves.at(-1)!.t, penalty: "none", scramble: "", source: "smartcube",
    moves, analysis: analyseSolve(scrambled, moves, null, { observedStartBottomFace: "D" }),
  } as Solve;
}

const solves = [solve("a", 1, 220), solve("b", 2, 200), solve("c", 3, 240), solve("now", 4, 180)];
const current = solves[3];
const analysis = current.analysis as SolveAnalysis;
const comparison = compareSolveToHistory(current, solves);
const spread = caseSpread(current, solves);

function charts(chart: ResultChart, scatter: ResultScatter = "recexec") {
  const controller = new Controller();
  controller.settings.update((settings) => ({ ...settings, resultChart: chart, resultScatter: scatter }));
  return renderToStaticMarkup(<ControllerContext.Provider value={controller}>
    <ResultCharts analysis={analysis} comparison={comparison} spread={spread} scope="session" loading={false} onScope={() => {}} />
  </ControllerContext.Provider>);
}

describe("Result charts", () => {
  it("has history to compare with", () => {
    expect(comparison?.sampleSize).toBe(3);
    expect(spread?.[1].label).toBe("F2L 1");
  });

  it.each(["dial", "scatter", "spread", "trend"] as const)("shows the %s chart the solver chose, marked as pressed", (chart) => {
    const html = charts(chart);
    const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(pressed[0].toLowerCase()).toBe(chart);
    expect(html.includes('aria-label="Scatter view"')).toBe(chart === "scatter");
    expect(html).toContain("Compare with");
  });

  it.each([["recexec", "Recognition against execution"], ["speed", "Turning speed against execution time"], ["thinkturn", "Turning speed against recognition"]] as const)(
    "draws the %s scatter view", (mode, label) => {
      expect(charts("scatter", mode)).toContain(`aria-label="${label}"`);
    });
});

describe("chart marks", () => {
  it("draws each step's trend with its usual range", () => {
    const html = renderToStaticMarkup(<StepTrends steps={analysis.steps} comparison={comparison} />);
    for (const label of ["Cross", "F1", "F2", "F3", "F4", "OLL", "PLL"]) expect(html).toContain(`>${label}</span>`);
    expect(html.match(/class="rc-trend-band"/g)).toHaveLength(7);
    expect(renderToStaticMarkup(<StepTrends steps={analysis.steps} comparison={null} />)).toContain("after 3 comparable solves");
  });

  it("draws the solve as a lap with the total in the middle and a tick per move", () => {
    const html = renderToStaticMarkup(<SolveDial analysis={analysis} />);
    expect(html).toContain(`${analysis.sliceTurns} moves`);
    expect(html.match(/class="rc-dial-tick"/g)).toHaveLength(analysis.sliceTurns);
  });

  it("draws arrows from the usual only when there is history", () => {
    expect(renderToStaticMarkup(<StepScatter steps={analysis.steps} comparison={comparison} mode="recexec" />)).toContain("rc-usual");
    expect(renderToStaticMarkup(<StepScatter steps={analysis.steps} comparison={null} mode="recexec" />)).not.toContain("rc-usual");
  });

  it("leaves the unmeasured cross out of thinking against turning", () => {
    const html = renderToStaticMarkup(<StepScatter steps={analysis.steps} comparison={comparison} mode="thinkturn" />);
    expect(html).not.toContain(">Cross</text>");
    expect(html).toContain("THINK FAST · TURN FAST");
  });

  it("spreads each case against its earlier times", () => {
    const html = renderToStaticMarkup(<CaseSpread rows={spread} loading={false} />);
    expect(html).toContain("OLL 27");
    expect(html).toContain("PLL T");
    expect(html).toMatch(/beat \d+%/);
    expect(renderToStaticMarkup(<CaseSpread rows={null} loading />)).toContain("Loading your history");
  });

  it("puts your usual range and median behind each step's bar in the table", () => {
    const html = renderToStaticMarkup(<DetailedStepBreakdown analysis={analysis} comparison={comparison} slim />);
    expect(html.match(/class="phase-usual"/g)).toHaveLength(7);
    expect(html.match(/class="phase-median"/g)).toHaveLength(7);
    expect(html).toContain("usual range");
    expect(renderToStaticMarkup(<DetailedStepBreakdown analysis={analysis} slim />)).not.toContain("phase-usual");
  });
});
