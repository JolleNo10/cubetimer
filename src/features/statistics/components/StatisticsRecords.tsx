import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { useMemo, useState } from "react";
import { formatSolveTime, type AverageWindow } from "../state/stats";
import { RANKING_METRICS, RECOGNITION_NOTE, sortRankingRows, sortSolveRows, type AverageMetric, type SolveSortColumn, type PbMetric, type RankingMetric, type RankingRow, type SortDirection, type StatisticsViewModel } from "../state/statistics";
import type { Session, Solve } from "../../../app/types";
import { statisticsActivationProps } from "./statisticsInteraction";

const PAGE_SIZE = 50;

export function StatisticsAverageDetail({ window, solves, sessions, onOpenSolve, onClose }: {
  window: AverageWindow; solves: readonly Solve[]; sessions: readonly Session[];
  onOpenSolve: (solve: Solve) => void; onClose: () => void;
}) {
  const { date } = useDateTimeFormat();
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
  const { date } = useDateTimeFormat();
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
        {model.sessionId === null ? <td>{model.eventSessions.find((session) => session.id === row.sessionId)?.name ?? "—"}</td> : null}<td>{date(row.createdAt)}</td><td>{row.context ? <span className="stats-badge">{row.context}{row.context.includes("at Cross") ? " · XCross" : ""}</span> : "—"}</td>
      </tr>)}
    </tbody></table></div>
    {lastPage > 0 ? <div className="row stats-pagination"><button className="ghost small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="small dim">Page {currentPage + 1} / {lastPage + 1}</span><button className="ghost small" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></div> : null}
  </>;
}

const SOLVE_COLUMNS: { id: SolveSortColumn; label: string }[] = [
  { id: "time", label: "Time" }, ...([5, 12, 50, 100] as const).map((size) => ({ id: `ao${size}` as const, label: `Ao${size}` })),
  { id: "tps", label: "TPS" }, { id: "stm", label: "STM" }, { id: "cross", label: "Cross" },
  { id: "f2l", label: "F2L" }, { id: "oll", label: "OLL" }, { id: "pll", label: "PLL" },
  { id: "session", label: "Session" }, { id: "date", label: "Date" },
];

export function StatisticsRecords({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const { date } = useDateTimeFormat();
  const [column, setColumn] = useState<SolveSortColumn>("time");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);
  const [pbMetric, setPbMetric] = useState<PbMetric>("single");
  const [average, setAverage] = useState<AverageWindow | null>(null);
  const rows = useMemo(() => sortSolveRows(model.solveRows, column, direction), [model, column, direction]);
  const columns = SOLVE_COLUMNS.filter((item) => item.id !== "session" || model.sessionId === null);
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const currentAverage = average ? model.solveRows.find((row) => row.solve.id === average.entries.at(-1)?.solveId)?.averages[`ao${average.size}` as AverageMetric] : undefined;
  const averageInScope = currentAverage && average && currentAverage.entries.every((entry, index) => entry.solveId === average.entries[index]?.solveId);
  const openPb = (row: RankingRow) => {
    if (row.kind === "average") setAverage(row.window);
    else { const solve = model.scopeSolves.find((solve) => solve.id === row.solveId); if (solve) onOpenSolve(solve); }
  };
  return <>
    <section className="stats-section"><div className="section-heading"><div><h2>Solves</h2><p>{rows.length} counted solves · full selected scope · select a row for its complete breakdown</p></div></div>
      <p className="small faint">Sort any column. Average values open exact Session-local windows. Unavailable metrics stay last; DNF is a result.</p>
      <div className="table-scroll"><table className="stats-table solves-table"><thead><tr>{columns.map(({ id, label }) => <th key={id} aria-sort={column === id ? direction === "asc" ? "ascending" : "descending" : "none"}>
        <button className="stats-sort" onClick={() => { setColumn(id); setDirection(column === id && direction === "asc" ? "desc" : "asc"); setPage(0); }}>{label}{column === id ? direction === "asc" ? " ↑" : " ↓" : ""}</button>
      </th>)}</tr></thead><tbody>{rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row) => <tr key={row.solve.id} {...statisticsActivationProps(() => onOpenSolve(row.solve), `View solve ${formatSolveTime(row.solve)} · ${date(row.date)}`)}>
        {columns.map(({ id }) => {
          if (id.startsWith("ao")) {
            const window = row.averages[id as AverageMetric];
            return <td key={id} className="number">{window ? <button className="ghost small mono stats-open-link" aria-label={`View Ao${window.size} window ending at ${row.solve.id}`} onClick={(event) => { event.stopPropagation(); setAverage(window); }}>{formatTime(window.value)}</button> : "—"}</td>;
          }
          return <td key={id} className={id === "session" || id === "date" ? undefined : "number"}>
            {id === "time" ? <button className="ghost small mono stats-open-link" onClick={() => onOpenSolve(row.solve)}>{formatSolveTime(row.solve)}</button>
              : id === "session" ? row.session : id === "date" ? date(row.date) : id === "stm" ? row.stm ?? "—" : id === "tps" ? row.tps?.toFixed(2) ?? "—" : formatTime(row[id as "cross" | "f2l" | "oll" | "pll"])}
            {id === "cross" && row.xCrossCount ? <span className="stats-badge" title={`${row.xCrossCount} pairs already solved at Cross`}>XCross · {row.xCrossCount}</span> : null}
          </td>;
        })}
      </tr>)}</tbody></table></div>
      {!rows.length ? <div className="chart-empty">No counted solves in this scope yet.</div> : null}
      {lastPage > 0 ? <div className="row stats-pagination"><button className="ghost small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="small dim">Page {currentPage + 1} / {lastPage + 1}</span><button className="ghost small" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></div> : null}
    </section>
    {averageInScope ? <StatisticsAverageDetail window={currentAverage} solves={model.scopeSolves} sessions={model.eventSessions} onOpenSolve={onOpenSolve} onClose={() => setAverage(null)} /> : null}
    <section className="stats-section"><div className="section-heading"><div><h2>PB history</h2><p>Strict improvements only · achieved Session-local average windows</p></div><label className="field">PB metric<select value={pbMetric} onChange={(e) => setPbMetric(e.target.value as PbMetric)}>{(["single", "ao5", "ao12", "ao50", "ao100"] as const).map((id) => <option key={id} value={id}>{id === "single" ? "Single" : `Ao${id.slice(2)}`}</option>)}</select></label></div>
      {model.pbHistory[pbMetric].length ? <div className="table-scroll"><table className="stats-table"><thead><tr><th>PB</th><th>Date</th><th>Source Session</th></tr></thead><tbody>{model.pbHistory[pbMetric].map((row) => <tr key={row.id} {...statisticsActivationProps(() => openPb(row), `View ${row.kind === "average" ? `Ao${row.window.size} window` : "solve"} · ${date(row.createdAt)}`)}><td><button className="ghost small mono stats-open-link" onClick={() => openPb(row)}>{formatTime(row.value)}</button></td><td>{date(row.createdAt)}</td><td>{model.eventSessions.find((session) => session.id === row.sessionId)?.name ?? "—"}{row.kind === "average" ? ` · ${row.window.size}-solve window` : ""}</td></tr>)}</tbody></table></div> : <div className="chart-empty">No achieved PBs for this metric yet.</div>}
    </section>
  </>;
}

const CFOP_METRICS = RANKING_METRICS.filter((item) => item.group === "Phases" || item.group === "Efficiency" || item.id === "recognition" || item.id === "execution");

export function StatisticsCfopRecords({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const [metric, setMetric] = useState<RankingMetric>("cross");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const rows = useMemo(() => sortRankingRows(model.records[metric], direction), [model, metric, direction]);
  const definition = RANKING_METRICS.find((item) => item.id === metric)!;
  const open = (row: RankingRow) => {
    if (row.kind !== "solve") return;
    const solve = model.scopeSolves.find((solve) => solve.id === row.solveId);
    if (solve) onOpenSolve(solve);
  };
  return <section className="stats-section"><div className="section-heading"><div><h2>CFOP records</h2><p>Phase times and efficiency · XCross context retained</p></div></div>
    <div className="statistics-controls">
      <label className="field">CFOP record metric<select value={metric} onChange={(e) => { const next = e.target.value as RankingMetric; setMetric(next); setDirection(RANKING_METRICS.find((item) => item.id === next)!.direction); }}>{CFOP_METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="field">Ranking direction<select value={direction} onChange={(e) => setDirection(e.target.value as SortDirection)}><option value="asc">{definition.unit === "time" ? "Fastest → slowest" : "Lowest → highest"}</option><option value="desc">{definition.unit === "time" ? "Slowest → fastest" : "Highest → lowest"}</option></select></label>
    </div>
    <p className="small faint">{RECOGNITION_NOTE} Phase TPS uses measured execution time.</p>
    <StatisticsRankingTable key={`${metric}:${direction}`} rows={rows} metric={metric} model={model} onOpen={open} />
  </section>;
}

export function StatisticsBestSplits({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const { date } = useDateTimeFormat();
  const solves = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  const open = (row: RankingRow) => { if (row.kind === "solve") { const solve = solves.get(row.solveId); if (solve) onOpenSolve(solve); } };
  return (
    <section className="stats-section"><div className="section-heading"><div><h2>Best splits</h2><p>Best observed phases from different solves; these may not combine into a real solve. F2L requires zero pairs completed at Cross.</p></div></div>
      <div className="table-scroll"><table className="stats-table"><thead><tr><th>Phase</th><th>Best time</th><th>Source solve / Session</th><th>Date</th></tr></thead><tbody>{model.bestSplits.sources.map(({ phase, record }) => <tr key={phase} {...statisticsActivationProps(record ? () => open(record) : undefined, `View ${phase} source solve`)}><td>{phase}</td><td>{formatTime(record?.value)}</td><td>{record ? <button className="ghost small stats-open-link" onClick={() => open(record)}>{record.kind === "solve" && solves.has(record.solveId) ? formatSolveTime(solves.get(record.solveId)!) : formatTime(record.totalTime)} · {model.eventSessions.find((session) => session.id === record.sessionId)?.name}</button> : "No eligible analysed sample"}</td><td>{record ? date(record.createdAt) : "—"}</td></tr>)}</tbody></table></div>
      <div className="stat-grid"><div className="stat-card"><span>Best Single</span><strong>{formatTime(model.bestSplits.pbMs)}</strong></div><div className="stat-card"><span>Best splits</span><strong>{formatTime(model.bestSplits.totalMs)}</strong></div><div className="stat-card"><span>PB − Best splits</span><strong>{formatTime(model.bestSplits.gapMs)}</strong></div></div>
    </section>
  );
}
