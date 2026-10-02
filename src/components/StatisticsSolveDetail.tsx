import { validatedSolveFacts, formatSolveTime, formatTime } from "../state/stats";
import { RECOGNITION_NOTE } from "../state/statistics";
import type { Session, Solve } from "../state/types";
import { DetailedStepBreakdown } from "./StepBreakdown";

export function StatisticsSolveDetail({ solve, session, onClose, onReplay, onTools }: {
  solve: Solve; session?: Session; onClose: () => void; onReplay: (solve: Solve) => void; onTools: (solve: Solve) => void;
}) {
  const facts = validatedSolveFacts(solve);
  const pausesMs = facts?.pauses.reduce((sum, pause) => sum + pause.durationMs, 0);
  return <div className="backdrop" onClick={onClose}><div className="dialog wide statistics-solve-detail" role="dialog" aria-modal="true" aria-label="Statistics solve detail" onClick={(e) => e.stopPropagation()}>
    <div className="dialog-head"><h3>Historical solve · {formatSolveTime(solve)}</h3><button className="ghost" onClick={onClose} aria-label="Close solve detail">×</button></div>
    <div className="dialog-body">
      <p>{session?.name ?? "Unknown Session"} · {new Date(solve.createdAt).toLocaleString()}</p>
      <div className="mono small stats-scramble">{solve.scramble || "No recorded scramble"}</div>
      <p className="stats-note">{solve.comment || "No note"}</p>
      <div className="row wrap"><button className="ghost" disabled={!solve.moves.length} onClick={() => onReplay(solve)}>Replay</button><button className="ghost" disabled={!facts} onClick={() => onTools(solve)}>Tools</button></div>
      {facts ? <>
        <div className="stat-grid">{[
          ["STM", String(facts.sliceTurns)], ["Whole-solve TPS", facts.tps.toFixed(2)],
          ["Measured recognition", formatTime(facts.recognitionMs)], ["Execution", formatTime(facts.executionMs)],
          ["Pauses ≥250 ms", `${facts.pauses.length} · ${formatTime(pausesMs)}`],
          ["Longest pause", formatTime(facts.pauses.length ? Math.max(...facts.pauses.map((pause) => pause.durationMs)) : undefined)],
        ].map(([label, value]) => <div key={label} className="stat-card"><span>{label}</span><strong>{value}</strong></div>)}</div>
        <DetailedStepBreakdown analysis={solve.analysis!} />
        <p className="small faint">{RECOGNITION_NOTE}</p>
      </> : <div className="chart-empty">No usable move-by-move CFOP analysis is available for this solve.</div>}
    </div>
  </div></div>;
}
