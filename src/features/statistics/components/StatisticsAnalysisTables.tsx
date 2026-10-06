import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { useMemo, useState } from "react";
import { formatSolveTime } from "../state/stats";
import { RECOGNITION_NOTE, sortCasePerformance, type CasePerformance, type CaseSort, type PerformanceSummary, type SortDirection, type StatisticsViewModel } from "../state/statistics";
import type { Solve } from "../../../app/types";
import type { LastLayerFamily } from "../../../cube/lastLayerTraining";
import { statisticsActivationProps } from "./statisticsInteraction";
import { SplitBar, StatCard, StatsSection } from "./StatisticsPrimitives";

export function PerformanceTable({ rows, onSelect }: { rows: readonly PerformanceSummary[]; onSelect?: (row: PerformanceSummary) => void }) {
  return <div className="table-scroll"><table className="stats-table"><thead><tr><th>Case / slot / order</th><th>Samples</th><th>Best</th><th>Median</th><th>Measured recognition median</th><th>Measured execution median</th><th>STM median</th><th>Execution TPS</th><th>Skips</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label} {...statisticsActivationProps(onSelect ? () => onSelect(row) : undefined, `View ${row.label} samples`)}><td>{onSelect ? <button className="ghost small stats-open-link" onClick={() => onSelect(row)}>{row.label}</button> : row.label}</td><td className="stats-samples">{row.count}{row.count > 0 && row.count < 3 ? <span className="stats-badge small-sample" title="Fewer than 3 observations; medians describe a very small sample.">small sample</span> : null}</td><td>{formatTime(row.bestMs)}</td><td>{formatTime(row.medianMs)}</td><td>{formatTime(row.recognitionMs)}</td><td>{formatTime(row.executionMs)}</td><td>{row.moves ?? "—"}</td><td>{row.tps?.toFixed(2) ?? "—"}</td><td>{row.skipCount}</td></tr>)}</tbody></table></div>;
}

export function StatisticsCaseTable({ family, rows, skipCount, focus = [], model, onOpenSolve, onTrainCase }: {
  family: LastLayerFamily; rows: readonly CasePerformance[]; skipCount: number; focus?: readonly CasePerformance[]; model: StatisticsViewModel;
  onOpenSolve: (solve: Solve) => void; onTrainCase: (family: LastLayerFamily, caseId: string) => void;
}) {
  const { date } = useDateTimeFormat();
  const [sort, setSort] = useState<CaseSort>("case");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [caseId, setCaseId] = useState<string | null>(null);
  const sorted = useMemo(() => sortCasePerformance(rows, sort, direction), [rows, sort, direction]);
  const selected = rows.find((row) => row.caseId === caseId);
  const members = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  return <StatsSection id={`${family}-cases`} title={`${family.toUpperCase()} cases`} description={`${rows.length} recognised cases · ${skipCount} skips (${model.analysisCount ? (skipCount / model.analysisCount * 100).toFixed(1) : "—"}% of analysed solves)`}>
    {focus.length ? <div className="focus-cases" role="group" aria-label={`Slowest ${family.toUpperCase()} cases`}>
      <span className="stat-label">Slowest cases</span>
      {focus.map((row) => <div className="focus-case" key={row.caseId}>
        <strong>{family.toUpperCase()} {row.caseId}</strong><span className="mono">{formatTime(row.medianMs)}</span><span className="small faint">{row.count} samples</span>
        <button className="ghost small" onClick={() => setCaseId(row.caseId)}>View</button>
        <button className="small" onClick={() => onTrainCase(family, row.caseId)}>Train</button>
      </div>)}
    </div> : null}
    <p className="small faint">{RECOGNITION_NOTE}</p>
    <div className="statistics-controls"><label className="field">{family.toUpperCase()} case sort<select value={sort} onChange={(e) => setSort(e.target.value as CaseSort)}>{(["case", "count", "median", "recognition", "execution", "tps"] as const).map((key) => <option key={key} value={key}>{{ case: "Case", count: "Samples", median: "Median", recognition: "Measured recognition", execution: "Measured execution", tps: "Execution TPS" }[key]}</option>)}</select></label><label className="field">Direction<select value={direction} onChange={(e) => setDirection(e.target.value as SortDirection)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>
    {rows.length ? <PerformanceTable rows={sorted} onSelect={(row) => setCaseId((row as CasePerformance).caseId)} /> : <div className="chart-empty">No recognised non-skipped {family.toUpperCase()} cases in this scope.</div>}
    {selected ? <div className="stats-detail" role="region" aria-label={`${family.toUpperCase()} case solves`}>
      <div className="section-heading"><h3>{family.toUpperCase()} {selected.caseId} · {selected.count} solves</h3><div className="row"><button onClick={() => onTrainCase(family, selected.caseId)}>Train case</button><button className="ghost" onClick={() => setCaseId(null)}>Close case</button></div></div>
      <div className="table-scroll"><table className="stats-table"><thead><tr><th>Solve</th><th>Session</th><th>Date</th></tr></thead><tbody>{selected.solveIds.map((id) => {
        const solve = members.get(id);
        return solve ? <tr key={id} {...statisticsActivationProps(() => onOpenSolve(solve), `View solve ${formatSolveTime(solve)} · ${date(solve.createdAt)}`)}><td><button className="ghost small stats-open-link" onClick={() => onOpenSolve(solve)}>{formatSolveTime(solve)}</button></td><td>{model.eventSessions.find((session) => session.id === solve.sessionId)?.name}</td><td>{date(solve.createdAt)}</td></tr> : null;
      })}</tbody></table></div>
    </div> : null}
  </StatsSection>;
}

export function StatisticsF2lPerformance({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const { date } = useDateTimeFormat();
  const [position, setPosition] = useState<string | null>(null);
  const [mode, setMode] = useState<"slot" | "order">("slot");
  const rows = mode === "slot" ? model.f2lSlots : model.f2lPositions;
  const selected = rows.find((row) => row.label === position);
  const members = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  return <StatsSection id="f2l" title="F2L performance">
    <p className="small faint">{mode === "slot" ? "Solver-relative F2L slot · skipped/XCross pairs counted separately" : "Pair completion order · skipped/XCross pairs counted separately"}</p>
    <p className="small faint">{RECOGNITION_NOTE}</p>
    <div className="statistics-mode" role="group" aria-label="F2L grouping">
      <button className="ghost" aria-pressed={mode === "slot"} onClick={() => { setMode("slot"); setPosition(null); }}>By slot</button>
      <button className="ghost" aria-pressed={mode === "order"} onClick={() => { setMode("order"); setPosition(null); }}>By solve order</button>
    </div>
    {mode === "slot" && model.f2lUnassignedCount ? <p className="small faint">{model.f2lUnassignedCount} F2L steps have no recognised slot and are excluded from slot summaries; completion-order analysis includes them.</p> : null}
    {model.analysisCount ? <PerformanceTable rows={rows} onSelect={(row) => setPosition(row.label)} /> : <div className="chart-empty">No usable CFOP analysis in this scope.</div>}
    {selected ? <div className="stats-detail" role="region" aria-label="F2L position solves">
      <div className="section-heading"><h3>{selected.label} · {selected.count} contributing solves</h3><button className="ghost" onClick={() => setPosition(null)}>Close pair</button></div>
      {selected.samples.length ? <div className="table-scroll"><table className="stats-table">
        <thead><tr><th>Pair time</th><th>Measured recognition</th><th>Measured execution</th><th>STM</th><th>Execution TPS</th><th>Solve time</th>{model.sessionId === null ? <th>Session</th> : null}<th>Date</th></tr></thead>
        <tbody>{selected.samples.map((sample) => {
          const solve = members.get(sample.solveId);
          return solve ? <tr key={sample.solveId} {...statisticsActivationProps(() => onOpenSolve(solve), `View solve ${formatSolveTime(solve)} · ${selected.label}`)}>
            <td>{formatTime(sample.timeMs)}</td><td>{formatTime(sample.recognitionMs)}</td><td>{formatTime(sample.executionMs)}</td><td>{sample.moves}</td><td>{sample.tps?.toFixed(2) ?? "—"}</td>
            <td><button className="ghost small stats-open-link" onClick={() => onOpenSolve(solve)}>{formatSolveTime(solve)}</button></td>
            {model.sessionId === null ? <td>{model.eventSessions.find((session) => session.id === solve.sessionId)?.name}</td> : null}<td>{date(solve.createdAt)}</td>
          </tr> : null;
        })}</tbody>
      </table></div> : <div className="chart-empty">No non-skipped samples for this position.</div>}
    </div> : null}
  </StatsSection>;
}

export function StatisticsAnalysisTables({ model, onOpenSolve, onTrainCase }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void; onTrainCase: (family: LastLayerFamily, caseId: string) => void }) {
  return <>
    <StatisticsF2lPerformance model={model} onOpenSolve={onOpenSolve} />
    <StatisticsCaseTable family="oll" rows={model.ollCases} skipCount={model.ollSkips} focus={model.ollFocus} model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} />
    <StatisticsCaseTable family="pll" rows={model.pllCases} skipCount={model.pllSkips} focus={model.pllFocus} model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} />
  </>;
}

export function StatisticsPauses({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const pauses = model.pauses;
  const longestSolve = model.scopeSolves.find((solve) => solve.id === pauses?.longest?.solveId);
  return (
    <StatsSection id="pauses" title="Pauses" description="Gaps ≥250 ms, attributed to the phase containing the next move. Pre-first-turn planning is unmeasured.">
      {pauses ? <>
        <div className="kpi-grid">
          <StatCard label="Pauses per solve" value={pauses.meanCount.toFixed(2)} detail={`${pauses.pauseCount} in ${pauses.sampleSize} analysed solves`} />
          <StatCard label="Typical pause" value={formatTime(pauses.meanDurationMs)} detail="Mean individual pause" />
          <StatCard label="Pause time per solve" value={formatTime(pauses.meanTotalMs)} detail="Mean total" />
          <StatCard label="Pause-free solves" value={`${(pauses.pauseFreeShare * 100).toFixed(1)}%`} detail={`${pauses.pauseFreeCount} / ${pauses.sampleSize}`} />
          <StatCard label="Longest pause" value={formatTime(pauses.longest?.durationMs)} onOpen={longestSolve ? () => onOpenSolve(longestSolve) : undefined}
            openLabel={longestSolve ? `View solve ${formatSolveTime(longestSolve)} with the longest pause` : undefined}
            detail={longestSolve ? `View solve ${formatSolveTime(longestSolve)}` : undefined} />
        </div>
        {pauses.pauseCount ? <SplitBar label="Pause time by phase" segments={pauses.phases.map((phase) => ({ series: `phase-${phase.name.toLowerCase()}`, label: phase.name, ms: phase.totalMs, share: phase.share }))} /> : null}
      </> : <div className="chart-empty">Pause analytics need usable CFOP analysis.</div>}
    </StatsSection>
  );
}

/** Spread of finished effective times; Best and Median themselves are shown in the summary. */
export function StatisticsConsistency({ model }: { model: StatisticsViewModel }) {
  const consistency = model.consistency;
  const rows: [string, string, string?][] = [
    ["Middle 50%", `${formatTime(consistency.p25Ms)} → ${formatTime(consistency.p75Ms)}`, "P25 → P75"],
    ["Middle 80%", `${formatTime(consistency.p10Ms)} → ${formatTime(consistency.p90Ms)}`, "P10 → P90"],
    ["Spread (IQR)", consistency.p25Ms === undefined || consistency.p75Ms === undefined ? "—" : formatTime(consistency.p75Ms - consistency.p25Ms)],
    ["PB vs median", formatTime(consistency.gapMs), consistency.gapShare === undefined ? undefined : `${(consistency.gapShare * 100).toFixed(1)}% of median`],
  ];
  return (
    <dl className="consistency-list" aria-label="Consistency">
      {rows.map(([label, value, detail]) => <div key={label}><dt>{label}{detail ? <small>{detail}</small> : null}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}
