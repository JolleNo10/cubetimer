import { effectiveCfopAnalysis, isUsableCfopAnalysis } from "../../../app/solveAnalysis";
import type { Penalty, Solve } from "../../../app/types";
const PENALTIES: { value: Penalty; label: string }[] = [
  { value: "none", label: "OK" }, { value: "+2", label: "+2" }, { value: "DNF", label: "DNF" },
];

/** Solve-management presentation; persistence and navigation belong to callers. */
export function SolveActions({ solve, onUpdate, onReplay, onSolveAgain, onDelete, onAttemptCorrection, onUndoCorrection }: {
  solve: Solve;
  onUpdate: (changes: Partial<Solve>) => void | Promise<unknown>;
  onReplay: (solve: Solve) => void;
  onSolveAgain: () => void;
  onDelete: () => void | Promise<unknown>;
  onAttemptCorrection?: () => void;
  onUndoCorrection?: () => void | Promise<unknown>;
}) {
  const analysis = effectiveCfopAnalysis(solve);
  const canReplay = solve.moves.length > 0;
  const canAnalyse = isUsableCfopAnalysis(solve) && canReplay;
  return (
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
              onClick={() => void onUpdate({ penalty: penalty.value })}
            >
              {penalty.label}
            </button>
          ))}
        </div>
        <div className="result-tools">
          {solve.cfopAnalysisCorrection ? (onUndoCorrection ? <button className="ghost" onClick={() => void onUndoCorrection()}>Undo correction</button> : null)
            : onAttemptCorrection && canReplay && (solve.scrambledFacelets || solve.scramble) && !isUsableCfopAnalysis(solve)
              ? <button className="ghost" onClick={onAttemptCorrection}>Attempt correction</button> : null}
          {analysis ? <button className="ghost"
            title={solve.cfopAnalysisExcluded
              ? "Remove your CFOP exclusion. Automatic quality checks still apply; solve timing is unchanged."
              : "Exclude this breakdown from CFOP statistics and CFOP-based tools. The solve time still counts normally."}
            onClick={() => void onUpdate({ cfopAnalysisExcluded: solve.cfopAnalysisExcluded ? undefined : true })}>
            {solve.cfopAnalysisExcluded ? "Undo CFOP exclusion" : "Mark CFOP wrong"}
          </button> : null}
          <button className="ghost" disabled={!canReplay} onClick={() => onReplay(solve)}
            title={canAnalyse ? "Replay the solve, step by step, with better ways to have done each step" : "Replay the solve"}>
            Review
          </button>
          <button
            className="ghost"
            onClick={onSolveAgain}
            title="Load this scramble so you can solve it again"
          >
            Solve again
          </button>
          <button
            className="ghost danger"
            onClick={() => void onDelete()}
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
        onBlur={(event) => void onUpdate({ comment: event.target.value })}
        aria-label="Solve note"
      />
    </div>
  );
}
