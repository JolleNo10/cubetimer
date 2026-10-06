import { SolveOutlierNotice } from "./SolveOutlierNotice";
import { useMemo, useState } from "react";
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
  const [filter, setFilter] = useState<"all" | "counted">("all");
  const visible = useMemo(() => solves
    .map((solve, index) => ({ solve, index: index + 1 }))
    .filter(({ solve }) => filter === "all" || isCountedSolve(solve)), [solves, filter]);
  // A slow solve is never a personal best; it was never a race.
  const best = useMemo(() => bestSingle(countedSolves(solves)), [solves]);

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head" style={{ flexWrap: "wrap" }}>
        <span className="panel-title">History</span>
        <select className="small" aria-label="History solves" value={filter} onChange={(event) => setFilter(event.target.value as "all" | "counted")}>
          <option value="all">All solves</option>
          <option value="counted">Counted only</option>
        </select>
        <span className="faint small">{filter === "all" ? solves.length : `${visible.length} / ${solves.length}`}</span>
      </div>
      <div className="panel-body tight" style={{ overflow: "auto" }}>
        {visible.length === 0 ? (
          <div className="empty">{solves.length === 0 ? "No solves yet. Scramble and go." : "No counted solves. Choose All solves to view the full history."}</div>
        ) : (
          [...visible].reverse().map(({ solve, index }) => {
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
