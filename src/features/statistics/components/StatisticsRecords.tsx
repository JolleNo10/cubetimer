import { SolveOutlierNotice } from "../../history/components/SolveOutlierNotice";
import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { useMemo, useState } from "react";
import { formatSolveTime, type AverageWindow } from "../state/stats";
import { RANKING_METRICS, RECOGNITION_NOTE, sortRankingRows, sortSolveRows, type AverageMetric, type SolveSortColumn, type PbMetric, type RankingMetric, type RankingRow, type SortDirection, type StatisticsViewModel } from "../state/statistics";
import type { Session, Solve } from "../../../app/types";
import { statisticsActivationProps } from "./statisticsInteraction";
import { Delta, Pagination, StatCard, StatsSection } from "./StatisticsPrimitives";

const PAGE_SIZE = 50;
/** Rankings show the top of a list; the full table pages more often. */
const RANKING_PAGE_SIZE = 10;

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

export function StatisticsRankingTable({ rows, metric, model, onOpen, direction, onToggleDirection }: {
  rows: readonly RankingRow[]; metric: RankingMetric; model: StatisticsViewModel; onOpen: (row: RankingRow) => void;
  /** When given, the value header reverses the ranking, like the Solves table headers. */
  direction?: SortDirection; onToggleDirection?: () => void;
}) {
  const { date } = useDateTimeFormat();
  const definition = RANKING_METRICS.find((item) => item.id === metric)!;
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(rows.length / RANKING_PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const offset = currentPage * RANKING_PAGE_SIZE;
  if (!rows.length) return <div className="chart-empty">No eligible {definition.label} records in this scope.{definition.group === "Averages" ? " An actual complete window is required." : metric !== "single" ? " Usable CFOP analysis is required." : ""}</div>;
  return <>
    <p className="small dim">{rows.length} records · full selected scope</p>
    <div className="table-scroll"><table className="stats-table"><thead><tr><th>Rank</th>{direction && onToggleDirection
      ? <th aria-sort={direction === "asc" ? "ascending" : "descending"}><button className="stats-sort" onClick={onToggleDirection}>{definition.label}{direction === "asc" ? " ↑" : " ↓"}</button></th>
      : <th>{definition.label}</th>}<th>Solve time</th><th>STM</th><th>{metric === "tps" || definition.group === "Solve" ? "Whole-solve TPS" : "Execution TPS"}</th>{model.sessionId === null ? <th>Session</th> : null}<th>Date</th><th>Context</th></tr></thead><tbody>
      {rows.slice(offset, offset + RANKING_PAGE_SIZE).map((row, index) => <tr key={row.id} {...statisticsActivationProps(() => onOpen(row), `${row.kind === "average" ? `View Ao${row.window.size} window` : `View solve ${formatTime(row.totalTime)}`} · ${date(row.createdAt)}`)}>
        <td>{offset + index + 1}</td><td><button className="ghost small mono stats-open-link" onClick={() => onOpen(row)}>{definition.unit === "time" ? formatTime(row.value) : definition.unit === "tps" ? row.value.toFixed(2) : row.value}</button></td>
        <td><button className="ghost small mono stats-open-link" onClick={() => onOpen(row)}>{row.kind === "average" ? "View window" : formatTime(row.totalTime)}</button></td><td>{row.moves ?? "—"}</td><td>{row.tps?.toFixed(2) ?? "—"}</td>
        {model.sessionId === null ? <td>{model.eventSessions.find((session) => session.id === row.sessionId)?.name ?? "—"}</td> : null}<td>{date(row.createdAt)}</td><td>{row.context ? <span className="stats-badge">{row.context}{row.context.includes("at Cross") ? " · XCross" : ""}</span> : "—"}</td>
      </tr>)}
    </tbody></table></div>
    <Pagination page={currentPage} lastPage={lastPage} onPageChange={setPage} />
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
    <StatisticsPbSummary model={model} onOpenSolve={onOpenSolve} onOpenAverage={setAverage} />
    <StatsSection id="solves" title="Solves" description={`${rows.length} counted solves · select a row for its breakdown, an average for its exact window`}>
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
            {id === "time" ? <SolveOutlierNotice solve={row.solve} /> : null}
            {id === "cross" && row.xCrossCount ? <span className="stats-badge" title={`${row.xCrossCount} pairs already solved at Cross`}>XCross · {row.xCrossCount}</span> : null}
          </td>;
        })}
      </tr>)}</tbody></table></div>
      {!rows.length ? <div className="chart-empty">No counted solves in this scope yet.</div> : null}
      <Pagination page={currentPage} lastPage={lastPage} onPageChange={setPage} />
    </StatsSection>
    {averageInScope ? <StatisticsAverageDetail window={currentAverage} solves={model.scopeSolves} sessions={model.eventSessions} onOpenSolve={onOpenSolve} onClose={() => setAverage(null)} /> : null}
    <StatsSection id="pb-history" title="PB history" description="Strict improvements only · achieved Session-local average windows" actions={<label className="field compact">PB metric<select value={pbMetric} onChange={(e) => setPbMetric(e.target.value as PbMetric)}>{(["single", "ao5", "ao12", "ao50", "ao100"] as const).map((id) => <option key={id} value={id}>{id === "single" ? "Single" : `Ao${id.slice(2)}`}</option>)}</select></label>}>
      {model.pbHistory[pbMetric].length ? <div className="table-scroll"><table className="stats-table"><thead><tr><th>PB</th><th>Date</th><th>Source Session</th></tr></thead><tbody>{model.pbHistory[pbMetric].map((row) => <tr key={row.id} {...statisticsActivationProps(() => openPb(row), `View ${row.kind === "average" ? `Ao${row.window.size} window` : "solve"} · ${date(row.createdAt)}`)}><td><button className="ghost small mono stats-open-link" onClick={() => openPb(row)}>{formatTime(row.value)}</button></td><td>{date(row.createdAt)}</td><td>{model.eventSessions.find((session) => session.id === row.sessionId)?.name ?? "—"}{row.kind === "average" ? ` · ${row.window.size}-solve window` : ""}</td></tr>)}</tbody></table></div> : <div className="chart-empty">No achieved PBs for this metric yet.</div>}
    </StatsSection>
  </>;
}

const CFOP_METRICS = RANKING_METRICS.filter((item) => item.group === "Phases" || item.group === "Efficiency" || item.id === "recognition" || item.id === "execution");

export function StatisticsCfopRecords({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const [metric, setMetric] = useState<RankingMetric>("cross");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const rows = useMemo(() => sortRankingRows(model.records[metric], direction), [model, metric, direction]);
  const open = (row: RankingRow) => {
    if (row.kind !== "solve") return;
    const solve = model.scopeSolves.find((solve) => solve.id === row.solveId);
    if (solve) onOpenSolve(solve);
  };
  return <StatsSection id="cfop-records" title="CFOP records" description="Phase times and efficiency · XCross context retained · select the value header to reverse the ranking"
    actions={<label className="field compact">CFOP record metric<select value={metric} onChange={(e) => { const next = e.target.value as RankingMetric; setMetric(next); setDirection(RANKING_METRICS.find((item) => item.id === next)!.direction); }}>{CFOP_METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}>
    <p className="small faint">{RECOGNITION_NOTE} Phase TPS uses measured execution time.</p>
    <StatisticsRankingTable key={`${metric}:${direction}`} rows={rows} metric={metric} model={model} onOpen={open} direction={direction} onToggleDirection={() => setDirection(direction === "asc" ? "desc" : "asc")} />
  </StatsSection>;
}

/** The best result of each tracked kind, opening its solve or exact average window. */
export function StatisticsPbSummary({ model, onOpenSolve, onOpenAverage }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void; onOpenAverage: (window: AverageWindow) => void }) {
  const { dateOnly } = useDateTimeFormat();
  const solves = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  const sessions = new Map(model.eventSessions.map((session) => [session.id, session.name]));
  return <div className="kpi-grid pb-summary" role="group" aria-label="Personal bests">
    {(["single", "ao5", "ao12", "ao50", "ao100"] as const).map((metric) => {
      const best = model.records[metric][0];
      const label = metric === "single" ? "Best single" : `Best Ao${metric.slice(2)}`;
      const open = !best ? undefined : best.kind === "average" ? () => onOpenAverage(best.window) : solves.has(best.solveId) ? () => onOpenSolve(solves.get(best.solveId)!) : undefined;
      return <StatCard key={metric} label={label} value={formatTime(best?.value)} tone={best ? undefined : "unavailable"} onOpen={open}
        openLabel={best ? `View ${label} ${formatTime(best.value)} · ${dateOnly(best.createdAt)}` : undefined}
        detail={best ? `${dateOnly(best.createdAt)}${model.sessionId === null ? ` · ${sessions.get(best.sessionId) ?? "—"}` : ""}` : metric === "single" ? "No finished solve" : "No achieved window"} />;
    })}
  </div>;
}

const PHASES = [
  { name: "Cross", record: "cross", delta: "crossDelta", recognition: undefined },
  { name: "F2L", record: "f2l", delta: "f2lDelta", recognition: "medianF2lRecognitionMs" },
  { name: "OLL", record: "oll", delta: "ollDelta", recognition: "medianOllRecognitionMs" },
  { name: "PLL", record: "pll", delta: "pllDelta", recognition: "medianPllRecognitionMs" },
] as const;

/** Median phase times with their recognition, recent change and best observed split. */
export function StatisticsPhaseTable({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const { date } = useDateTimeFormat();
  const solves = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  const open = (row: RankingRow | undefined) => { if (row?.kind === "solve") { const solve = solves.get(row.solveId); if (solve) onOpenSolve(solve); } };
  const medians = new Map(model.cfop?.map((phase) => [phase.name, phase.timeMs]));
  const max = Math.max(...(model.cfop ?? []).map((phase) => phase.timeMs), 1);
  const recent = model.recentPerformance;
  const analysis = model.recognitionExecution;
  return <StatsSection id="phases" title="Phases" description={<>Medians over analysed solves · Δ compares the latest {recent ? recent.sampleSize : "—"} with the {recent ? recent.sampleSize : "—"} before · Best splits come from different solves and may not combine into a real one. F2L requires zero pairs completed at Cross.</>}>
    {model.cfop?.length ? <div className="table-scroll"><table className="stats-table phase-table">
      <thead><tr><th>Phase</th><th>Median</th><th>Recognition</th><th>Recent Δ</th><th>Best split</th><th>Source</th></tr></thead>
      <tbody>{PHASES.map((phase) => {
        const median = medians.get(phase.name);
        const record = model.bestSplits.sources.find((source) => source.phase === phase.name)?.record;
        const source = record?.kind === "solve" ? solves.get(record.solveId) : undefined;
        return <tr key={phase.name} {...statisticsActivationProps(source ? () => open(record) : undefined, `View ${phase.name} best split source solve`)}>
          <td>{phase.name}</td>
          <td className="phase-median-cell"><div className="phase-track"><span className={`phase-${phase.record}`} style={{ width: `${(median ?? 0) / max * 100}%` }} /></div><strong>{formatTime(median)}</strong></td>
          <td className="number">{phase.recognition && analysis ? formatTime(analysis[phase.recognition]) : "—"}</td>
          <td className="number">{recent ? <Delta ms={recent[phase.delta]} /> : "—"}</td>
          <td className="number">{formatTime(record?.value)}</td>
          <td>{record ? <button className="ghost small stats-open-link" onClick={() => open(record)}>{source ? formatSolveTime(source) : formatTime(record.totalTime)} · {model.eventSessions.find((session) => session.id === record.sessionId)?.name} · {date(record.createdAt)}</button> : "No eligible analysed sample"}</td>
        </tr>;
      })}</tbody>
    </table></div> : <div className="chart-empty">No usable CFOP analysis in this scope.</div>}
    <div className="kpi-grid">
      <StatCard label="Best single" value={formatTime(model.bestSplits.pbMs)} />
      <StatCard label="Sum of best splits" value={formatTime(model.bestSplits.totalMs)} />
      <StatCard label="PB − best splits" value={formatTime(model.bestSplits.gapMs)} detail="Time a perfect combination would save" />
    </div>
  </StatsSection>;
}
