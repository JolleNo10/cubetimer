import { useController } from "../hooks/useController";
import { formatTime } from "../state/stats";
import { effectiveMs, type Penalty, type Solve } from "../state/types";

const PENALTIES: { value: Penalty; label: string }[] = [
  { value: "none", label: "OK" },
  { value: "+2", label: "+2" },
  { value: "DNF", label: "DNF" },
];

/** Penalties, comment and scramble for whichever solve is selected. */
export function SolveDetail({ solve }: { solve: Solve }) {
  const controller = useController();

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Selected solve</span>
        <span className="mono dim">{formatTime(effectiveMs(solve))}</span>
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="mono small faint" style={{ wordBreak: "break-word" }}>
          {solve.scramble}
        </div>
        <div className="row">
          {PENALTIES.map((penalty) => (
            <button
              key={penalty.value}
              className={solve.penalty === penalty.value ? "primary" : ""}
              onClick={() => void controller.updateSolve(solve.id, { penalty: penalty.value })}
            >
              {penalty.label}
            </button>
          ))}
          <span className="grow" />
          <button
            className="ghost"
            onClick={() => controller.replayScramble(solve.scramble)}
            title="Load this scramble so you can solve it again"
          >
            Replay
          </button>
          <button
            className="ghost danger"
            onClick={() => void controller.deleteSolve(solve.id)}
          >
            Delete
          </button>
        </div>
        <input
          placeholder="Add a note…"
          defaultValue={solve.comment ?? ""}
          key={solve.id}
          onBlur={(e) => void controller.updateSolve(solve.id, { comment: e.target.value })}
          aria-label="Solve note"
        />
      </div>
    </div>
  );
}
