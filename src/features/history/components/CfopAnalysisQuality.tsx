import { isCountedSolve } from "../../statistics/state/stats";
import { isTrustedCfopAnalysis, type CfopAnalysisIssue } from "../../../cube/analysis";
import { faceColour } from "../../../cube/colours";
import type { Solve } from "../../../app/types";

function reason(issue: CfopAnalysisIssue): string {
  switch (issue.code) {
    case "bottom-evidence-conflict": return `The solve-start bottom ${faceColour(issue.observedStart).name} disagrees with the whole-solve gyro bottom ${faceColour(issue.tracked).name}.`;
    case "cross-face-conflict": return `${issue.source === "whole-solve-gyro" ? "Whole-solve gyro bottom" : "Observed bottom"} ${faceColour(issue.observed).name} (${issue.observed}) disagrees with inferred Cross ${faceColour(issue.inferred).name} (${issue.inferred}).`;
    case "ambiguous-cross": return `Cross interpretation is ambiguous between ${issue.candidates.map(face => `${faceColour(face).name} (${face})`).join(" and ")}.`;
    case "incoherent-cfop-progression": return "The recorded states did not produce a reliable CFOP phase progression.";
    case "unassigned-f2l-slot": return `${issue.step} could not be assigned a concrete slot.`;
    case "unrecognized-oll": return "The reconstructed OLL state was not recognized.";
    case "unrecognized-pll": return "The reconstructed PLL state was not recognized.";
  }
}

export function CfopAnalysisWarning({ solve }: { solve: Pick<Solve, "analysis" | "cfopAnalysisExcluded"> }) {
  const analysis = solve.analysis;
  if (!analysis || (!solve.cfopAnalysisExcluded && isTrustedCfopAnalysis(analysis))) return null;
  return <div className="notice" role="note" style={{ display: "block" }}>
    <strong>{solve.cfopAnalysisExcluded ? "CFOP analysis excluded" : "CFOP analysis uncertain"}</strong>
    <p className="small" style={{ margin: "6px 0" }}>{solve.cfopAnalysisExcluded ? "You marked this breakdown as incorrect. It is excluded from CFOP statistics and CFOP-based tools." : "This breakdown could not be identified reliably and is excluded from CFOP statistics."}</p>
    {analysis.quality?.issues?.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      {analysis.quality.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{reason(issue)}</li>)}
    </ul> : !isTrustedCfopAnalysis(analysis) ? <span className="small faint">This older analysis has not been verified under the current quality checks.</span> : null}
  </div>;
}

export function CfopAnalysisBadge({ solve }: { solve: Solve }) {
  if (solve.source !== "smartcube" || !isCountedSolve(solve)) return null;
  if (solve.cfopAnalysisExcluded) return <span className="phase-case muted" title="You excluded this CFOP breakdown">CFOP excluded</span>;
  if (solve.analysis && !isTrustedCfopAnalysis(solve.analysis)) {
    return <span className="phase-case muted" title="Uncertain CFOP analysis; excluded from CFOP statistics">CFOP uncertain</span>;
  }
  if (!solve.analysis && solve.source === "smartcube" && solve.moves.length > 0) {
    return <span className="phase-case muted" title="A reliable CFOP breakdown could not be identified">no CFOP</span>;
  }
  return null;
}
