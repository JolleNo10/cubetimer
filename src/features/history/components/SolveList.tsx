import { SolveOutlierNotice } from "./SolveOutlierNotice";
import { useMemo } from "react";
import { useController } from "../../../app/useController";
import {
  practiceScrambleLabel,
  practiceScrambleTitle,
} from "../../../app/scrambleProvider";
import { bestSingle, countedSolves, formatSolveTime, isSlowSolve, isCountedSolve } from "../../statistics/state/stats";
import { effectiveMs, type Solve } from "../../../app/types";

type Props = {
  solves: Solve[];
  selectedId: string | null;
  onSelect: (solve: Solve) => void;
};

export function SolveList({ solves, selectedId, onSelect }: Props) {
  const controller = useController();
  // A slow solve is never a personal best; it was never a race.
  const best = useMemo(() => bestSingle(countedSolves(solves)), [solves]);

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head">
        <span className="panel-title">History</span>
        <span className="faint small">{solves.length}</span>
      </div>
      <div className="panel-body tight" style={{ overflow: "auto" }}>
        {solves.length === 0 ? (
          <div className="empty">No solves yet. Scramble and go.</div>
        ) : (
          [...solves].reverse().map((solve, reverseIndex) => {
            const index = solves.length - reverseIndex;
            const time = effectiveMs(solve);
            const isPb = time !== null && time === best && isCountedSolve(solve);
            const specialLabel = practiceScrambleLabel(solve.scrambleProvider);
            const specialTitle = practiceScrambleTitle(solve.scrambleProvider);
            return (
              <div
                key={solve.id}
                className={`solve-row${solve.id === selectedId ? " selected" : ""}`}
                onClick={() => onSelect(solve)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(solve);
                  }
                }}
              >
                <span className="index">{index}</span>
                <span className="row" style={{ gap: 7 }}>
                  <span className={`time${time === null ? " dnf" : ""}`}>
                    {formatSolveTime(solve)}
                  </span>
                  <SolveOutlierNotice solve={solve} />
                  {isPb ? <span className="pb small">PB</span> : null}
                  {isSlowSolve(solve) ? (
                    <span className="phase-case muted" title="Slow solve, not counted">
                      slow
                    </span>
                  ) : solve.replay ? (
                    <span className="phase-case muted" title="Replay practice solve, not counted">
                      replay
                    </span>
                  ) : null}
                  {specialLabel ? (
                    <span className="phase-case muted" title={specialTitle ?? specialLabel}>
                      {specialLabel}
                    </span>
                  ) : null}
                </span>
                <span className="badges">
                  {/* Count moves the way the breakdown does, so the two agree. */}
                  {solve.analysis || solve.moves.length > 0 ? (
                    <span>
                      {solve.analysis?.sliceTurns ?? solve.moves.length}&nbsp;mv
                    </span>
                  ) : null}
                  <button
                    className="ghost"
                    style={{ padding: "0 6px" }}
                    title="Delete solve"
                    aria-label={`Delete solve ${index}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void controller.deleteSolve(solve.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
