import { isUsableCfopAnalysis } from "../../../app/solveAnalysis";
import { SolveOutlierNotice } from "./SolveOutlierNotice";
import { SolveAnalysisReview } from "./SolveAnalysisReview";
import { type SolveStep } from "../../../cube/analysis";
import { useController } from "../../../app/useController";
import {
  practiceScrambleLabel,
  practiceScrambleTitle,
} from "../../../app/scrambleProvider";
import { formatSolveTime, isSlowSolve } from "../../statistics/state/stats";
import type { Penalty, Solve } from "../../../app/types";

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
  onPracticeStep,
}: {
  solve: Solve;
  solves: readonly Solve[];
  onContinue: (options?: { resumeTimer?: boolean }) => void;
  onReplay: (solve: Solve) => void;
  onAnalyse: (solve: Solve) => void;
  onPracticeStep?: (step: SolveStep) => void;
}) {
  const controller = useController();
  const analysis = solve.analysis ?? null;
  const moveCount = analysis?.sliceTurns ?? solve.moves.length;
  const canReplay = solve.moves.length > 0;
  const canAnalyse = Boolean(isUsableCfopAnalysis(solve) && solve.moves.length > 0);
  const slowSolve = isSlowSolve(solve);
  const specialLabel = practiceScrambleLabel(solve.scrambleProvider);
  const specialTitle = practiceScrambleTitle(solve.scrambleProvider);
  const primary = slowSolve ? `${moveCount} moves` : formatSolveTime(solve);

  return (
    <section className="panel solve-result" aria-label="Solve result">
      <div className="result-head">
        <div>
          <div className="result-title-row">
            <div className="panel-title">Result</div>
            <SolveOutlierNotice solve={solve} />
            {slowSolve ? <span className="phase-case muted">slow solve</span> : null}
            {!slowSolve && solve.replay ? <span className="phase-case muted">replay</span> : null}
            {specialLabel ? (
              <span className="phase-case muted" title={specialTitle ?? specialLabel}>
                {specialLabel}
              </span>
            ) : null}
          </div>
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
            !slowSolve ? (
              <div className="result-compact">
                {analysis.sliceTurns} moves · {analysis.tps.toFixed(2)} TPS
              </div>
            ) : null
          ) : !slowSolve && solve.moves.length > 0 ? (
            <div className="result-compact">{moveCount} moves</div>
          ) : null}
        </div>

        <div className="result-context">
          <div className="result-scramble">
            <span className="result-context-label">SOLVE SCRAMBLE</span>
            <span className="mono">{solve.scramble}</span>
          </div>
          <div className="result-actions">
            <div className="result-penalties">
              <span className="result-context-label">Penalty</span>
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
              {analysis ? <button className="ghost"
                title={solve.cfopAnalysisExcluded
                  ? "Remove your CFOP exclusion. Automatic quality checks still apply; solve timing is unchanged."
                  : "Exclude this breakdown from CFOP statistics and CFOP-based tools. The solve time still counts normally."}
                onClick={() => void controller.updateSolve(solve.id, { cfopAnalysisExcluded: solve.cfopAnalysisExcluded ? undefined : true })}>
                {solve.cfopAnalysisExcluded ? "Undo CFOP exclusion" : "Mark CFOP wrong"}
              </button> : null}
              {analysis && solve.moves.length > 0 ? (
                <button
                  className="ghost"
                  disabled={!canAnalyse}
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
                  onContinue({ resumeTimer: false });
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
          <SolveAnalysisReview solve={solve} solves={solves} analysis={analysis} onPracticeStep={onPracticeStep} />
        ) : (
          <div className="empty result-no-analysis">
            {solve.source === "keyboard"
              ? "No move-by-move breakdown is available for keyboard-timed solves."
              : solve.source === "smartcube" && solve.moves.length > 0
                ? "A reliable CFOP breakdown could not be identified for this solve. Replay is still available."
                : "No move-by-move breakdown is available for this solve."}
          </div>
        )}
      </div>
    </section>
  );
}
