import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CfopAnalysisBadge, CfopAnalysisWarning } from "./CfopAnalysisQuality";
import type { Solve } from "../../../app/types";
import type { SolveAnalysis } from "../../../cube/analysis";
const analysis = { method: "CFOP", analysisVersion: 3, quality: { status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["D", "L"] }, { code: "unassigned-f2l-slot", step: "F2L Slot 2" }, { code: "unrecognized-oll" }, { code: "unrecognized-pll" }] } } as SolveAnalysis;
it("shows a compact independent badge for suspect and unavailable CFOP analysis", () => {
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{ analysis } as Solve} />)).toContain("CFOP uncertain");
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{ source: "smartcube", moves: [{ move: "R", t: 0 }] } as Solve} />)).toContain("no CFOP");
  expect(renderToStaticMarkup(<CfopAnalysisBadge solve={{ source: "keyboard", moves: [] } as unknown as Solve} />)).toBe("");
});
it("translates structured quality issues into inspectable reasons", () => {
  const html = renderToStaticMarkup(<CfopAnalysisWarning analysis={analysis} />);
  for (const reason of ["CFOP analysis uncertain", "F2L Slot 2", "OLL", "PLL"]) expect(html).toContain(reason);
});
