import type { SolveAnalysis, SolveStep } from "../../../cube/analysis";
import { compareSolveToHistory, formatTime } from "../../statistics/state/stats";
import { RECOGNITION_NOTE } from "../../statistics/state/statistics";
import type { Solve } from "../../../app/types";
import { SolveComparisonPanel } from "./SolveComparison";
import { DetailedStepBreakdown } from "./StepBreakdown";

/** Shared analytical presentation; callers own navigation and mutation actions. */
export function SolveAnalysisReview({ solve, solves, analysis, onPracticeStep }: {
  solve: Solve; solves: readonly Solve[]; analysis: SolveAnalysis;
  onPracticeStep?: (step: SolveStep) => void;
}) {
  const pauseMs = analysis.pauses.reduce((sum, pause) => sum + pause.durationMs, 0);
  return <>
    <div className="result-metrics">
      <ReviewMetric label="Measured recognition" value={formatTime(analysis.totalRecognitionMs)} />
      <ReviewMetric label="Execution" value={formatTime(analysis.totalExecutionMs)} />
      <ReviewMetric label="Moves / STM" value={String(analysis.sliceTurns)} />
      <ReviewMetric label="Whole-solve TPS" value={analysis.tps.toFixed(2)} />
      <ReviewMetric label="Pauses ≥250 ms" value={`${analysis.pauses.length} pause${analysis.pauses.length === 1 ? "" : "s"} · ${formatTime(pauseMs)}s`} />
      <ReviewMetric label="Longest pause" value={formatTime(analysis.pauses.length ? Math.max(...analysis.pauses.map((pause) => pause.durationMs)) : undefined)} />
    </div>
    {analysis.stepsSkipped > 0 ? <div className="result-badge">{analysis.stepsSkipped} {analysis.stepsSkipped === 1 ? "step" : "steps"} skipped</div> : null}
    {analysis.turnsAfterSolution > 0 ? <div className="result-badge">{analysis.turnsAfterSolution} turns after the cube was solved</div> : null}
    <DetailedStepBreakdown analysis={analysis} onPracticeStep={onPracticeStep} />
    <SolveComparisonPanel comparison={compareSolveToHistory(solve, solves)} />
    <p className="result-note">{RECOGNITION_NOTE}</p>
  </>;
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return <div className="result-metric"><span className="result-metric-label">{label}</span><strong className="mono">{value}</strong></div>;
}
