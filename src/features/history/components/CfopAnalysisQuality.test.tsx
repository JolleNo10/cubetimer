import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CfopAnalysisBadge, CfopAnalysisWarning } from "./CfopAnalysisQuality";
import type { Solve } from "../../../app/types";
import type { SolveAnalysis } from "../../../cube/analysis";
const analysis = { method: "CFOP", analysisVersion: 3, quality: { status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["D", "L"] }, { code: "unassigned-f2l-slot", step: "F2L Slot 2" }, { code: "unrecognized-oll" }, { code: "unrecognized-pll" }] } } as SolveAnalysis;
it("shows a compact independent badge for suspect and unavailable CFOP analysis", () => {
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{ analysis, source: "smartcube" } as Solve} />)).toContain("CFOP uncertain");
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{ source: "smartcube", moves: [{ move: "R", t: 0 }] } as Solve} />)).toContain("no CFOP");
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{ source: "keyboard", moves: [] } as unknown as Solve} />)).toBe("");
});
it("translates structured quality issues into inspectable reasons", () => {
  const html = renderToStaticMarkup(<CfopAnalysisWarning solve={{ analysis }} />);
  for (const reason of ["CFOP analysis uncertain", "F2L Slot 2", "OLL", "PLL"]) expect(html).toContain(reason);
});


it.each([{ slowSolve: true }, { replay: true }, { practice: true }, { statisticsOutlier: { action: "exclude", baselineMs: 10000, multiplier: 3 } }])("hides compact CFOP badges for non-counting solves %j without hiding detailed warnings", flags => {
  for (const stored of [analysis, null]) {
    const solve = { source: "smartcube", moves: [{ move: "R", t: 0 }], analysis: stored, ...flags } as Solve;
    expect(renderToStaticMarkup(<CfopAnalysisBadge solve={solve} />)).toBe("");
  }
  expect(renderToStaticMarkup(<CfopAnalysisWarning solve={{ analysis }} />)).toContain("CFOP analysis uncertain");
});
it("presents colours, gyro provenance and generic incoherence without candidate internals", () => {
  const varied = { ...analysis, quality: { status: "suspect" as const, issues: [
    { code: "ambiguous-cross" as const, candidates: ["U", "L"] as const },
    { code: "cross-face-conflict" as const, observed: "U" as const, inferred: "L" as const, source: "whole-solve-gyro" as const },
    { code: "incoherent-cfop-progression" as const },
  ] } };
  const html = renderToStaticMarkup(<CfopAnalysisWarning solve={{ analysis: varied as SolveAnalysis }} />);
  expect(html).toContain("white (U) and orange (L)"); expect(html).toContain("Whole-solve gyro bottom");
  expect(html).toContain("reliable CFOP phase progression");
});


it("distinguishes manual exclusion from machine uncertainty, retaining reasons and badge precedence", () => {
  const solve = { source:"smartcube",analysis,cfopAnalysisExcluded:true } as Solve;
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={solve} />)).toContain("CFOP excluded");
  const html = renderToStaticMarkup(<CfopAnalysisWarning solve={solve} />);
  expect(html).toContain("You marked this breakdown as incorrect"); expect(html).toContain("F2L Slot 2");
  for(const flags of [{slowSolve:true},{practice:true},{replay:true}]) expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{...solve,...flags}} />)).toBe("");
});


it("explains disagreement between the two independent physical observations", () => {
  const conflicting = { ...analysis, quality: { status: "suspect" as const, issues: [
    { code: "bottom-evidence-conflict" as const, observedStart: "D" as const, tracked: "U" as const },
  ] } };
  const html = renderToStaticMarkup(<CfopAnalysisWarning solve={{ analysis: conflicting }} />);
  expect(html).toContain("solve-start bottom yellow disagrees with the whole-solve gyro bottom white");
});
