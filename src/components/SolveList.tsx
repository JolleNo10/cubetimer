import { useMemo } from "react";
import { useController } from "../hooks/useController";
import { bestSingle, formatSolveTime } from "../state/stats";
import { effectiveMs, type Solve } from "../state/types";

type Props = {
  solves: Solve[];
  selectedId: string | null;
  onSelect: (solve: Solve) => void;
};

export function SolveList({ solves, selectedId, onSelect }: Props) {
  const controller = useController();
  const best = useMemo(() => bestSingle(solves), [solves]);

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head">
        <span className="panel-title">Solves</span>
        <span className="faint small">{solves.length}</span>
      </div>
      <div className="panel-body tight" style={{ overflow: "auto" }}>
        {solves.length === 0 ? (
          <div className="empty">No solves yet. Scramble and go.</div>
        ) : (
          [...solves].reverse().map((solve, reverseIndex) => {
            const index = solves.length - reverseIndex;
            const time = effectiveMs(solve);
            const isPb = time !== null && time === best;
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
                  <span className={`time${solve.penalty === "DNF" ? " dnf" : ""}`}>
                    {formatSolveTime(solve)}
                  </span>
                  {isPb ? <span className="pb small">PB</span> : null}
                </span>
                <span className="badges">
                  {solve.moves.length > 0 ? <span>{solve.moves.length}&nbsp;mv</span> : null}
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
