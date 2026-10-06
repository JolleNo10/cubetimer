import { isTrustedCfopAnalysis, type CfopAnalysisIssue, type SolveAnalysis } from "../../../cube/analysis";
import { faceColour } from "../../../cube/colours";
import type { Solve } from "../../../app/types";

function reason(issue: CfopAnalysisIssue): string {
  switch (issue.code) {
    case "cross-face-conflict": return `Observed bottom ${faceColour(issue.observed).name} (${issue.observed}) disagrees with inferred Cross ${faceColour(issue.inferred).name} (${issue.inferred}).`;
    case "ambiguous-cross": return `Cross face is ambiguous: ${issue.candidates.join(", ")}.`;
    case "unassigned-f2l-slot": return `${issue.step} could not be assigned a concrete slot.`;
    case "unrecognized-oll": return "The reconstructed OLL state was not recognized.";
    case "unrecognized-pll": return "The reconstructed PLL state was not recognized.";
  }
}

export function CfopAnalysisWarning({ analysis }: { analysis: SolveAnalysis }) {
  if (isTrustedCfopAnalysis(analysis)) return null;
  return <div className="notice" role="note" style={{ display: "block" }}>
    <strong>CFOP analysis uncertain</strong>
    <p className="small" style={{ margin: "6px 0" }}>This breakdown could not be identified reliably and is excluded from CFOP statistics.</p>
    {analysis.quality?.issues?.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      {analysis.quality.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{reason(issue)}</li>)}
    </ul> : <span className="small faint">This older analysis has not been verified under the current quality checks.</span>}
  </div>;
}

export function CfopAnalysisBadge({ solve }: { solve: Solve }) {
  if (solve.analysis && !isTrustedCfopAnalysis(solve.analysis)) {
    return <span className="phase-case muted" title="Uncertain CFOP analysis; excluded from CFOP statistics">CFOP uncertain</span>;
  }
  if (!solve.analysis && solve.source === "smartcube" && solve.moves.length > 0) {
    return <span className="phase-case muted" title="A reliable CFOP breakdown could not be identified">no CFOP</span>;
  }
  return null;
}
