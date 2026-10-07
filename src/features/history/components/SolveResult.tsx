import { SolveActions } from "./SolveActions";
import { SolveOutlierNotice } from "./SolveOutlierNotice";
import { SolveAnalysisReview } from "./SolveAnalysisReview";
import { type SolveStep } from "../../../cube/analysis";
import { useController } from "../../../app/useController";
import {
  practiceScrambleLabel,
  practiceScrambleTitle,
} from "../../../app/scrambleProvider";
import { formatSolveTime, isSlowSolve } from "../../statistics/state/stats";
import type { Solve } from "../../../app/types";

export function SolveResult({
  solve,
  solves,
  onContinue,
  onReplay,
  onPracticeStep,
}: {
  solve: Solve;
  solves: readonly Solve[];
  onContinue: (options?: { resumeTimer?: boolean }) => void;
  /** Open the review: the replay, how each step went and what would have been better. */
  onReplay: (solve: Solve) => void;
  onPracticeStep?: (step: SolveStep) => void;
}) {
  const controller = useController();
  const analysis = solve.analysis ?? null;
  const moveCount = analysis?.sliceTurns ?? solve.moves.length;
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

        <SolveActions solve={solve} onUpdate={changes => controller.updateSolve(solve.id, changes)} onReplay={onReplay}
          onSolveAgain={() => { controller.replayScramble(solve.scramble, solve.scrambleProvider); onContinue({ resumeTimer: false }); }}
          onDelete={() => controller.deleteSolve(solve.id)} />

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
