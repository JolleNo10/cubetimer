import { StepBreakdown } from "./StepBreakdown";
import type { Solve } from "../state/types";

/**
 * CFOP breakdown of a solve: how long each step took, how much of that was spent
 * looking rather than turning, which case came up, and where the long pauses were.
 */
export function AnalysisPanel({
  solve,
  onReplay,
}: {
  solve: Solve | null;
  onReplay: (solve: Solve) => void;
}) {
  const analysis = solve?.analysis ?? null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Solve breakdown</span>
        {solve && solve.moves.length > 0 ? (
          <button className="ghost" onClick={() => onReplay(solve)}>
            Replay
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {!solve ? (
          <div className="empty">Finish a solve to see its breakdown.</div>
        ) : !analysis ? (
          <div className="empty">
            {solve.source === "keyboard"
              ? "Connect a smart cube to get a move-by-move breakdown."
              : "This solve has no step analysis."}
          </div>
        ) : (
          <StepBreakdown analysis={analysis} />
        )}
      </div>
    </div>
  );
}
