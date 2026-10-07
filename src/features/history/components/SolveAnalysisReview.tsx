import { isUsableCfopAnalysis } from "../../../app/solveAnalysis";
import { CfopAnalysisWarning } from "./CfopAnalysisQuality";
import { formatTime } from "../../../shared/time";
import { type SolveAnalysis, type SolveStep } from "../../../cube/analysis";
import { RECOGNITION_NOTE } from "../../statistics/state/statistics";
import type { Solve } from "../../../app/types";
import { DetailedStepBreakdown } from "./StepBreakdown";
import { ResultCharts } from "./resultCharts/ResultCharts";
import { useResultHistory } from "./resultCharts/useResultHistory";

/** Shared analytical presentation; callers own navigation and mutation actions. */
export function SolveAnalysisReview({ solve, solves, analysis, onPracticeStep }: {
  solve: Solve; solves: readonly Solve[]; analysis: SolveAnalysis;
  onPracticeStep?: (step: SolveStep) => void;
}) {
  const pauseMs = analysis.pauses.reduce((sum, pause) => sum + pause.durationMs, 0);
  const history = useResultHistory(solve, solves);
  return <>
    <CfopAnalysisWarning solve={solve} />
    <div className="result-metrics">
      <ReviewMetric label="Measured recognition" value={formatTime(analysis.totalRecognitionMs)} />
      <ReviewMetric label="Execution" value={formatTime(analysis.totalExecutionMs)} />
      <ReviewMetric label="Moves / STM" value={String(analysis.sliceTurns)} />
      <ReviewMetric label="Whole-solve TPS" value={analysis.tps.toFixed(2)} />
      <ReviewMetric label={"Pauses ≥250\u00a0ms"} value={String(analysis.pauses.length)} detail={`${formatTime(pauseMs)}s total`} />
      <ReviewMetric label="Longest pause" value={formatTime(analysis.pauses.length ? Math.max(...analysis.pauses.map((pause) => pause.durationMs)) : undefined)} />
    </div>
    {analysis.stepsSkipped > 0 ? <div className="result-badge">{analysis.stepsSkipped} {analysis.stepsSkipped === 1 ? "step" : "steps"} skipped</div> : null}
    {analysis.turnsAfterSolution > 0 ? <div className="result-badge">{analysis.turnsAfterSolution} turns after the cube was solved</div> : null}
    {/* Chart beside the table when the panel is wide enough, above it otherwise. */}
    <div className="result-analysis">
      <div className="result-analysis-body">
        <ResultCharts analysis={analysis} comparison={history.comparison} spread={history.spread}
          scope={history.scope} loading={history.loading} onScope={history.setScope} />
        <DetailedStepBreakdown analysis={analysis} onPracticeStep={isUsableCfopAnalysis(solve) ? onPracticeStep : undefined}
          comparison={history.comparison} slim />
      </div>
    </div>
    <p className="result-note">{RECOGNITION_NOTE}</p>
  </>;
}

function ReviewMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="result-metric">
    <span className="result-metric-label">{label}</span>
    <strong className="mono">{value}</strong>
    {detail ? <span className="result-metric-detail">{detail}</span> : null}
  </div>;
}
