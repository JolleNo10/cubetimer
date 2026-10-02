import { useMemo, useState } from "react";
import { formatTime, formatSolveTime, type AverageWindow } from "../state/stats";
import { RANKING_METRICS, RECOGNITION_NOTE, sortRankingRows, type PbMetric, type RankingMetric, type RankingRow, type SortDirection, type StatisticsViewModel } from "../state/statistics";
import type { Session, Solve } from "../state/types";
import { statisticsActivationProps } from "./statisticsInteraction";

const PAGE_SIZE = 50;
const date = (at: number) => new Date(at).toLocaleString();

export function StatisticsAverageDetail({ window, solves, sessions, onOpenSolve, onClose }: {
  window: AverageWindow; solves: readonly Solve[]; sessions: readonly Session[];
  onOpenSolve: (solve: Solve) => void; onClose: () => void;
}) {
  const members = new Map(solves.map((solve) => [solve.id, solve]));
  const names = new Map(sessions.map((session) => [session.id, session.name]));
  const first = members.get(window.entries[0]?.solveId);
  const last = members.get(window.entries.at(-1)?.solveId ?? "");
  return <div className="stats-detail" role="region" aria-label="Average detail">
    <div className="section-heading"><div><h3>Ao{window.size} · {formatTime(window.value)}</h3><p>{first ? date(first.createdAt) : "—"} → {last ? date(last.createdAt) : "—"}</p></div><button className="ghost" onClick={onClose}>Close average</button></div>
    <p className="small dim">Exact chronological window. The best and worst results are discarded.</p>
    <div className="table-scroll"><table className="stats-table"><thead><tr><th>#</th><th>Result</th><th>Session</th><th>Date</th><th>Average membership</th></tr></thead><tbody>
      {window.entries.map((entry, index) => {
        const solve = members.get(entry.solveId);
        return <tr key={entry.solveId} {...statisticsActivationProps(solve ? () => onOpenSolve(solve) : undefined, `View solve ${formatTime(entry.time)} · ${solve ? date(solve.createdAt) : ""}`)}><td>{index + 1}</td><td><button className="ghost small stats-open-link" disabled={!solve} onClick={() => solve && onOpenSolve(solve)}>{solve ? formatSolveTime(solve) : formatTime(entry.time)}</button></td><td>{solve ? names.get(solve.sessionId) ?? "Unknown Session" : "—"}</td><td>{solve ? date(solve.createdAt) : "—"}</td><td>{entry.trim === "kept" ? "Counted" : `Discarded ${entry.trim}`}{entry.causesDnf ? " · causes DNF average" : ""}</td></tr>;
      })}
    </tbody></table></div>
  </div>;
}

export function StatisticsRankingTable({ rows, metric, model, onOpen }: { rows: readonly RankingRow[]; metric: RankingMetric; model: StatisticsViewModel; onOpen: (row: RankingRow) => void }) {
  const definition = RANKING_METRICS.find((item) => item.id === metric)!;
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const offset = currentPage * PAGE_SIZE;
  if (!rows.length) return <div className="chart-empty">No eligible {definition.label} records in this scope.{definition.group === "Averages" ? " An actual complete window is required." : metric !== "single" ? " Usable CFOP analysis is required." : ""}</div>;
  return <>
    <p className="small dim">{rows.length} records · full selected scope</p>
    <div className="table-scroll"><table className="stats-table"><thead><tr><th>Rank</th><th>{definition.label}</th><th>Solve time</th><th>STM</th><th>{metric === "tps" || definition.group === "Solve" ? "Whole-solve TPS" : "Execution TPS"}</th>{model.sessionId === null ? <th>Session</th> : null}<th>Date</th><th>Context</th></tr></thead><tbody>
      {rows.slice(offset, offset + PAGE_SIZE).map((row, index) => <tr key={row.id} {...statisticsActivationProps(() => onOpen(row), `${row.kind === "average" ? `View Ao${row.window.size} window` : `View solve ${formatTime(row.totalTime)}`} · ${date(row.createdAt)}`)}>
        <td>{offset + index + 1}</td><td><button className="ghost small mono stats-open-link" onClick={() => onOpen(row)}>{definition.unit === "time" ? formatTime(row.value) : definition.unit === "tps" ? row.value.toFixed(2) : row.value}</button></td>
        <td><button className="ghost small mono stats-open-link" onClick={() => onOpen(row)}>{row.kind === "average" ? "View window" : formatTime(row.totalTime)}</button></td><td>{row.moves ?? "—"}</td><td>{row.tps?.toFixed(2) ?? "—"}</td>
        {model.sessionId === null ? <td>{row.kind === "average" ? "Rolling window" : model.eventSessions.find((session) => session.id === row.sessionId)?.name ?? "—"}</td> : null}<td>{date(row.createdAt)}</td><td>{row.context || "—"}</td>
      </tr>)}
    </tbody></table></div>
    {lastPage > 0 ? <div className="row stats-pagination"><button className="ghost small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="small dim">Page {currentPage + 1} / {lastPage + 1}</span><button className="ghost small" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></div> : null}
  </>;
}

export function StatisticsRecords({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const [metric, setMetric] = useState<RankingMetric>("single");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [pbMetric, setPbMetric] = useState<PbMetric>("single");
  const [average, setAverage] = useState<Extract<RankingRow, { kind: "average" }> | null>(null);
  const rows = useMemo(() => sortRankingRows(model.records[metric], direction), [model, metric, direction]);
  const solves = useMemo(() => new Map(model.scopeSolves.map((solve) => [solve.id, solve])), [model]);
  const open = (row: RankingRow) => {
    if (row.kind === "average") setAverage(row);
    else { const solve = solves.get(row.solveId); if (solve) onOpenSolve(solve); }
  };
  const definition = RANKING_METRICS.find((item) => item.id === metric)!;
  return <>
    <section className="stats-section"><div className="section-heading"><div><h2>Records</h2><p>Rank historical solves and actual rolling averages.</p></div></div>
      <div className="statistics-controls">
        <label className="field">Record metric<select value={metric} onChange={(e) => { const next = e.target.value as RankingMetric; setMetric(next); setDirection(RANKING_METRICS.find((item) => item.id === next)!.direction); }}>
          {["Solve", "Averages", "Phases", "Efficiency"].map((group) => <optgroup key={group} label={group}>{RANKING_METRICS.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
        </select></label>
        <label className="field">Ranking direction<select value={direction} onChange={(e) => setDirection(e.target.value as SortDirection)}><option value="asc">{definition.unit === "time" ? "Fastest → slowest" : "Lowest → highest"}</option><option value="desc">{definition.unit === "time" ? "Slowest → fastest" : "Highest → lowest"}</option></select></label>
      </div>
      <p className="small faint">{RECOGNITION_NOTE} Whole-solve TPS includes recognition; phase TPS uses execution time.</p>
      <StatisticsRankingTable key={`${metric}:${direction}`} rows={rows} metric={metric} model={model} onOpen={open} />
    </section>
    {average && average.solveIds.every((id) => solves.has(id)) ? <StatisticsAverageDetail window={average.window} solves={model.scopeSolves} sessions={model.eventSessions} onOpenSolve={onOpenSolve} onClose={() => setAverage(null)} /> : null}
    <section className="stats-section"><div className="section-heading"><div><h2>PB history</h2><p>Strict improvements only · full selected scope</p></div><label className="field">PB metric<select value={pbMetric} onChange={(e) => setPbMetric(e.target.value as PbMetric)}>{(["single", "ao5", "ao12", "ao50", "ao100"] as const).map((id) => <option key={id} value={id}>{id === "single" ? "Single" : `Ao${id.slice(2)}`}</option>)}</select></label></div>
      {model.pbHistory[pbMetric].length ? <div className="table-scroll"><table className="stats-table"><thead><tr><th>PB</th><th>Date</th><th>Source</th></tr></thead><tbody>{model.pbHistory[pbMetric].map((row) => <tr key={row.id} {...statisticsActivationProps(() => open(row), `View ${row.kind === "average" ? `Ao${row.window.size} window` : "solve"} · ${date(row.createdAt)}`)}><td><button className="ghost small mono stats-open-link" onClick={() => open(row)}>{formatTime(row.value)}</button></td><td>{date(row.createdAt)}</td><td>{row.kind === "average" ? `${row.window.size}-solve window` : model.eventSessions.find((session) => session.id === row.sessionId)?.name ?? "—"}</td></tr>)}</tbody></table></div> : <div className="chart-empty">No achieved PBs for this metric yet.</div>}
    </section>
    <section className="stats-section"><div className="section-heading"><div><h2>Best splits</h2><p>Best observed phases from different solves; these may not combine into a real solve.</p></div></div>
      <div className="table-scroll"><table className="stats-table"><thead><tr><th>Phase</th><th>Best time</th><th>Source solve / Session</th><th>Date</th></tr></thead><tbody>{model.bestSplits.sources.map(({ phase, record }) => <tr key={phase} {...statisticsActivationProps(record ? () => open(record) : undefined, `View ${phase} source solve`)}><td>{phase}</td><td>{formatTime(record?.value)}</td><td>{record ? <button className="ghost small stats-open-link" onClick={() => open(record)}>{record.kind === "solve" && solves.has(record.solveId) ? formatSolveTime(solves.get(record.solveId)!) : formatTime(record.totalTime)} · {model.eventSessions.find((session) => session.id === record.sessionId)?.name}</button> : "No eligible analysed sample"}</td><td>{record ? date(record.createdAt) : "—"}</td></tr>)}</tbody></table></div>
      <div className="stat-grid"><div className="stat-card"><span>Best Single</span><strong>{formatTime(model.bestSplits.pbMs)}</strong></div><div className="stat-card"><span>Best splits</span><strong>{formatTime(model.bestSplits.totalMs)}</strong></div><div className="stat-card"><span>PB − Best splits</span><strong>{formatTime(model.bestSplits.gapMs)}</strong></div></div>
    </section>
  </>;
}
