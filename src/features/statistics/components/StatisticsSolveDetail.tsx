import { SolveActions } from "../../history/components/SolveActions";
import { SolveOutlierNotice } from "../../history/components/SolveOutlierNotice";
import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { formatSolveTime } from "../state/stats";
import { effectiveMs, type Session, type Solve } from "../../../app/types";
import { SolveAnalysisReview } from "../../history/components/SolveAnalysisReview";
import { StatCard } from "./StatisticsPrimitives";

export function StatisticsSolveDetail({ solve, solves, session, onClose, onReplay, onUpdate, onDelete, onSolveAgain }: {
  solve: Solve; solves: readonly Solve[]; session?: Session; onClose: () => void; onReplay: (solve: Solve) => void;
  onUpdate: (changes: Partial<Solve>) => Promise<unknown>; onDelete: () => Promise<unknown>; onSolveAgain: () => void;
}) {
  const { date } = useDateTimeFormat();
  return <div className="backdrop" onClick={onClose}><div className="dialog wide statistics-solve-detail" role="dialog" aria-modal="true" aria-label="Statistics solve detail" onClick={(e) => e.stopPropagation()}>
    <div className="dialog-head"><h3>Historical solve · {formatSolveTime(solve)}</h3><button className="ghost" onClick={onClose} aria-label="Close solve detail">×</button></div>
    <div className="dialog-body">
      <SolveOutlierNotice solve={solve} />
      <p>{session?.name ?? "Unknown Session"} · {date(solve.createdAt)}</p>
      <div className="kpi-grid">{[
        ["Result", formatTime(effectiveMs(solve))], ["Raw time", formatTime(solve.rawMs)],
        ["Penalty", solve.penalty === "none" ? "OK" : solve.penalty],
        ["Source", { smartcube: "Smart cube", keyboard: "Keyboard", import: "Import" }[solve.source]],
        ...(solve.inspectionMs === undefined ? [] : [["Inspection", formatTime(solve.inspectionMs)]]),
      ].map(([label, value]) => <StatCard key={label} label={label} value={value} />)}</div>
      <SolveActions solve={solve} onUpdate={onUpdate} onDelete={onDelete} onReplay={onReplay} onSolveAgain={onSolveAgain} />
      {solve.analysis ? <SolveAnalysisReview solve={solve} solves={solves} analysis={solve.analysis!} /> : <div className="chart-empty">No usable move-by-move CFOP analysis is available for this solve.</div>}
    </div>
  </div></div>;
}
