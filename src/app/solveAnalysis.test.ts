import { describe, expect, it } from "vitest";
import { ANALYSIS_VERSION, type SolveAnalysis } from "../cube/analysis";
import { effectiveCfopAnalysis, isUsableCfopAnalysis, solveForCfopInterpretation } from "./solveAnalysis";
import type { Solve } from "./types";

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

describe("CFOP correction interpretation", () => {
  const base = { method: "CFOP", analysisVersion: ANALYSIS_VERSION, crossFace: "L", quality: { status: "suspect", issues: [] } } as unknown as SolveAnalysis;
  const corrected = { ...base, crossFace: "U", quality: { status: "trusted", issues: [] } } as SolveAnalysis;
  const original = { analysis: base, gripTrack: "|DF", solveStartBottomFace: "L" } as Solve;
  const accepted: Solve = { ...original, cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 123, analysis: corrected } };
  it("selects the overlay without authorizing the base, and returns the base after Undo", () => {
    expect(effectiveCfopAnalysis(original)).toBe(base);
    expect(isUsableCfopAnalysis(original)).toBe(false);
    expect(effectiveCfopAnalysis(accepted)).toBe(corrected);
    expect(isUsableCfopAnalysis(accepted)).toBe(true);
    expect(isUsableCfopAnalysis({ ...accepted, cfopAnalysisExcluded: true })).toBe(false);
    const { cfopAnalysisCorrection: _correction, ...undone } = accepted;
    expect(effectiveCfopAnalysis(undone)).toBe(base);
  });
  it("filters orientation evidence transiently while preserving the source exactly", () => {
    expect(solveForCfopInterpretation(original)).toBe(original);
    const projected = solveForCfopInterpretation(accepted);
    expect(projected.analysis).toBe(corrected);
    expect(projected.gripTrack).toBeUndefined();
    expect(projected.solveStartBottomFace).toBeUndefined();
    expect(accepted.analysis).toBe(base);
    expect(accepted.gripTrack).toBe(original.gripTrack);
    expect(accepted.solveStartBottomFace).toBe("L");
    const preview = solveForCfopInterpretation(original, corrected);
    expect(preview.analysis).toBe(corrected);
    expect(preview.gripTrack).toBeUndefined();
    expect(preview.cfopAnalysisCorrection).toBeUndefined();
  });
  it("quarantines a correction that becomes suspect instead of falling back", () => {
    const suspect = { ...accepted, analysis: corrected, cfopAnalysisCorrection: { ...accepted.cfopAnalysisCorrection!, analysis: base } };
    expect(effectiveCfopAnalysis(suspect)).toBe(base);
    expect(isUsableCfopAnalysis(suspect)).toBe(false);
  });
});
