import { formatTime } from "../../../shared/time";
import { validatedSolveFacts, formatSolveTime } from "../state/stats";
import { effectiveMs, type Session, type Solve } from "../../../app/types";
import { SolveAnalysisReview } from "../../history/components/SolveAnalysisReview";

export function StatisticsSolveDetail({ solve, solves, session, onClose, onReplay, onTools }: {
  solve: Solve; solves: readonly Solve[]; session?: Session; onClose: () => void; onReplay: (solve: Solve) => void; onTools: (solve: Solve) => void;
}) {
  const facts = validatedSolveFacts(solve);
  const canAnalyse = Boolean(facts && solve.moves.length > 0);
  return <div className="backdrop" onClick={onClose}><div className="dialog wide statistics-solve-detail" role="dialog" aria-modal="true" aria-label="Statistics solve detail" onClick={(e) => e.stopPropagation()}>
    <div className="dialog-head"><h3>Historical solve · {formatSolveTime(solve)}</h3><button className="ghost" onClick={onClose} aria-label="Close solve detail">×</button></div>
    <div className="dialog-body">
      <p>{session?.name ?? "Unknown Session"} · {new Date(solve.createdAt).toLocaleString()}</p>
      <div className="stat-grid">{[
        ["Result", formatTime(effectiveMs(solve))], ["Raw time", formatTime(solve.rawMs)],
        ["Penalty", solve.penalty === "none" ? "OK" : solve.penalty],
        ["Source", { smartcube: "Smart cube", keyboard: "Keyboard", import: "Import" }[solve.source]],
        ...(solve.inspectionMs === undefined ? [] : [["Inspection", formatTime(solve.inspectionMs)]]),
      ].map(([label, value]) => <div key={label} className="stat-card"><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="mono small stats-scramble">{solve.scramble || "No recorded scramble"}</div>
      <p className="stats-note">{solve.comment || "No note"}</p>
      <div className="row wrap"><button className="ghost" disabled={!solve.moves.length} onClick={() => onReplay(solve)}>Replay</button><button className="ghost" disabled={!canAnalyse} onClick={() => onTools(solve)}>Tools</button></div>
      {facts ? <SolveAnalysisReview solve={solve} solves={solves} analysis={solve.analysis!} /> : <div className="chart-empty">No usable move-by-move CFOP analysis is available for this solve.</div>}
    </div>
  </div></div>;
}
