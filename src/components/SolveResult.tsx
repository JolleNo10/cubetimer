import { SolveComparisonPanel } from "./SolveComparison";
import { StepBreakdown } from "./StepBreakdown";
import { useController } from "../hooks/useController";
import { compareSolveToHistory, formatSolveTime, formatTime, isSlowSolve } from "../state/stats";
import type { Penalty, Solve } from "../state/types";

const PENALTIES: { value: Penalty; label: string }[] = [
  { value: "none", label: "OK" },
  { value: "+2", label: "+2" },
  { value: "DNF", label: "DNF" },
];

export function SolveResult({
  solve,
  solves,
  onContinue,
  onReplay,
  onAnalyse,
}: {
  solve: Solve;
  solves: readonly Solve[];
  onContinue: () => void;
  onReplay: (solve: Solve) => void;
  onAnalyse: (solve: Solve) => void;
}) {
  const controller = useController();
  const analysis = solve.analysis ?? null;
  const moveCount = analysis?.sliceTurns ?? solve.moves.length;
  const canReplay = solve.moves.length > 0;
  const canAnalyse = Boolean(analysis && solve.moves.length > 0);
  const pauseMs = analysis?.pauses.reduce((sum, pause) => sum + pause.durationMs, 0) ?? 0;
  const slowSolve = isSlowSolve(solve);
  const primary = slowSolve ? `${moveCount} moves` : formatSolveTime(solve);
  const comparison = analysis ? compareSolveToHistory(solve, solves) : null;

  return (
    <section className="panel solve-result" aria-label="Solve result">
      <div className="result-head">
        <div>
          <div className="panel-title">Result</div>
          {slowSolve ? <span className="phase-case muted">slow solve</span> : null}
        </div>
      </div>

      <div className="solve-result-body">
        <div className="result-hero">
          <div className="result-primary mono">{primary}</div>
          {slowSolve ? (
            <div className="result-secondary">
              elapsed <b>{formatSolveTime(solve)}</b>
            </div>
          ) : null}
          {analysis ? (
            <div className="result-compact">
              {analysis.sliceTurns} moves · {analysis.tps.toFixed(2)} TPS
            </div>
          ) : solve.moves.length > 0 ? (
            <div className="result-compact">{moveCount} moves</div>
          ) : null}
        </div>

        <div className="result-context">
          <div className="result-scramble">
            <span className="result-context-label">SCRAMBLE</span>
            <span className="mono">{solve.scramble}</span>
          </div>
          <div className="result-actions">
            <div className="result-penalties">
              {PENALTIES.map((penalty) => (
                <button
                  key={penalty.value}
                  className={solve.penalty === penalty.value ? "primary" : ""}
                  onClick={() => void controller.updateSolve(solve.id, { penalty: penalty.value })}
                >
                  {penalty.label}
                </button>
              ))}
            </div>
            <div className="result-tools">
              {canAnalyse ? (
                <button
                  className="ghost"
                  onClick={() => onAnalyse(solve)}
                  title="Look for shorter ways to have done each step"
                >
                  Tools
                </button>
              ) : null}
              {canReplay ? (
                <button className="ghost" onClick={() => onReplay(solve)}>
                  Replay
                </button>
              ) : null}
              <button
                className="ghost"
                onClick={() => {
                  controller.replayScramble(solve.scramble, solve.scrambleProvider);
                  onContinue();
                }}
                title="Load this scramble so you can solve it again"
              >
                Solve again
              </button>
              <button
                className="ghost danger"
                onClick={() => void controller.deleteSolve(solve.id)}
              >
                Delete
              </button>
            </div>
          </div>
          <input
            className="result-note-input"
            placeholder="Add a note…"
            defaultValue={solve.comment ?? ""}
            key={solve.id}
            onBlur={(event) => void controller.updateSolve(solve.id, { comment: event.target.value })}
            aria-label="Solve note"
          />
        </div>

        {analysis ? (
          <>
            <div className="result-metrics">
              <ResultMetric label="Measured recognition" value={formatTime(analysis.totalRecognitionMs)} />
              <ResultMetric label="Execution" value={formatTime(analysis.totalExecutionMs)} />
              <ResultMetric label="Moves / STM" value={String(analysis.sliceTurns)} />
              <ResultMetric label="TPS" value={analysis.tps.toFixed(2)} />
              <ResultMetric
                label="Pauses"
                value={`${analysis.pauses.length} pause${analysis.pauses.length === 1 ? "" : "s"} · ${formatTime(pauseMs)}s`}
                detail="over 250 ms"
              />
            </div>
            {analysis.stepsSkipped > 0 ? (
              <div className="result-badge">{analysis.stepsSkipped} steps skipped</div>
            ) : null}

            <div className="result-breakdown">
              <div className="result-breakdown-grid">
                <div className="result-step-heading" aria-hidden="true">
                  <span>Step</span>
                  <span>Total</span>
                  <span>Cumulative</span>
                  <span>Recognition</span>
                  <span>Execution</span>
                  <span>Moves</span>
                  <span>TPS</span>
                </div>
                <StepBreakdown
                  analysis={analysis}
                  showMoves
                  showFullSolution={false}
                  showDetail={false}
                  showCumulativeTime
                  showSplitTimes
                  showTimeScale
                  showMoveGraph={false}
                />
              </div>
            </div>
            <SolveComparisonPanel comparison={comparison} />
            <p className="result-note">
              Recognition is inferred from move timing; cross planning before the first turn is not measured.
            </p>
          </>
        ) : (
          <div className="empty result-no-analysis">
            {solve.source === "keyboard"
              ? "No move-by-move breakdown is available for keyboard-timed solves."
              : "No move-by-move breakdown is available for this solve."}
          </div>
        )}
      </div>

      <div className="result-foot">
        <span className="faint small">Continue when ready.</span>
        <button className="primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </section>
  );
}

function ResultMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="result-metric">
      <span className="result-metric-label">{label}</span>
      <strong className="mono">{value}</strong>
      {detail ? <span className="result-metric-detail">{detail}</span> : null}
    </div>
  );
}
