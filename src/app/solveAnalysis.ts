import { isTrustedCfopAnalysis, type SolveAnalysis } from "../cube/analysis";
import type { Solve } from "./types";

type CfopInterpretation = Pick<Solve, "analysis" | "cfopAnalysisCorrection" | "cfopAnalysisExcluded">;

export function effectiveCfopAnalysis(solve: CfopInterpretation): SolveAnalysis | null | undefined {
  return solve.cfopAnalysisCorrection ? solve.cfopAnalysisCorrection.analysis : solve.analysis;
}

/** Application eligibility: user veto can exclude machine trust, never override uncertainty. */
export function isUsableCfopAnalysis(solve: CfopInterpretation): boolean {
  return solve.cfopAnalysisExcluded !== true && isTrustedCfopAnalysis(effectiveCfopAnalysis(solve));
}

/** Transient interpretation input for Replay/Training, never a replacement stored Solve.
 * A supplied analysis is a state-only Review preview, not an acceptance decision.
 */
export function solveForCfopInterpretation(solve: Solve, previewAnalysis?: SolveAnalysis): Solve {
  const analysis = previewAnalysis ?? solve.cfopAnalysisCorrection?.analysis;
  if (!analysis) return solve;
  return { ...solve, analysis, gripTrack: undefined, solveStartBottomFace: undefined };
}
