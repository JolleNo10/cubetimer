import { isTrustedCfopAnalysis, type SolveAnalysis } from "../cube/analysis";
import type { Solve } from "./types";

/** Application eligibility: user veto can exclude machine trust, never override uncertainty. */
export function isUsableCfopAnalysis(solve: Pick<Solve, "analysis" | "cfopAnalysisExcluded">): solve is typeof solve & { analysis: SolveAnalysis } {
  return solve.cfopAnalysisExcluded !== true && isTrustedCfopAnalysis(solve.analysis);
}
