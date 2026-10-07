import { describe, expect, it } from "vitest";
import { ANALYSIS_VERSION, type SolveAnalysis } from "../cube/analysis";
import { isUsableCfopAnalysis } from "./solveAnalysis";

describe("manual CFOP veto", () => {
  it.each([false, true])("only permits automatically trusted analysis without veto %s", veto => {
    for (const status of ["trusted", "suspect"] as const) {
      const analysis = { method: "CFOP", analysisVersion: ANALYSIS_VERSION, quality: { status, issues: [] } } as unknown as SolveAnalysis;
      expect(isUsableCfopAnalysis({ analysis, cfopAnalysisExcluded: veto ? true : undefined })).toBe(status === "trusted" && !veto);
    }
  });
  it("does not authorize missing or legacy analysis", () => {
    expect(isUsableCfopAnalysis({ analysis: null })).toBe(false);
    expect(isUsableCfopAnalysis({ analysis: { method: "CFOP" } as SolveAnalysis })).toBe(false);
  });
});
