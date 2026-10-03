import { useMemo, useState } from "react";
import { formatTime, formatSolveTime } from "../state/stats";
import { RECOGNITION_NOTE, sortCasePerformance, type CasePerformance, type CaseSort, type PerformanceSummary, type SortDirection, type StatisticsViewModel } from "../state/statistics";
import type { Solve } from "../state/types";
import type { LastLayerFamily } from "../cube/lastLayerTraining";
import { statisticsActivationProps } from "./statisticsInteraction";

export function PerformanceTable({ rows, onSelect }: { rows: readonly PerformanceSummary[]; onSelect?: (row: PerformanceSummary) => void }) {
  return <div className="table-scroll"><table className="stats-table"><thead><tr><th>Case / slot / order</th><th>Samples</th><th>Best</th><th>Median</th><th>Measured recognition median</th><th>Measured execution median</th><th>STM median</th><th>Execution TPS</th><th>Skips</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label} {...statisticsActivationProps(onSelect ? () => onSelect(row) : undefined, `View ${row.label} samples`)}><td>{onSelect ? <button className="ghost small stats-open-link" onClick={() => onSelect(row)}>{row.label}</button> : row.label}</td><td className="stats-samples">{row.count}{row.count > 0 && row.count < 3 ? <span className="stats-badge small-sample" title="Fewer than 3 observations; medians describe a very small sample.">small sample</span> : null}</td><td>{formatTime(row.bestMs)}</td><td>{formatTime(row.medianMs)}</td><td>{formatTime(row.recognitionMs)}</td><td>{formatTime(row.executionMs)}</td><td>{row.moves ?? "—"}</td><td>{row.tps?.toFixed(2) ?? "—"}</td><td>{row.skipCount}</td></tr>)}</tbody></table></div>;
}

export function StatisticsCaseTable({ family, rows, skipCount, model, onOpenSolve, onTrainCase }: {
  family: LastLayerFamily; rows: readonly CasePerformance[]; skipCount: number; model: StatisticsViewModel;
  onOpenSolve: (solve: Solve) => void; onTrainCase: (family: LastLayerFamily, caseId: string) => void;
}) {
  const [sort, setSort] = useState<CaseSort>("case");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [caseId, setCaseId] = useState<string | null>(null);
  const sorted = useMemo(() => sortCasePerformance(rows, sort, direction), [rows, sort, direction]);
  const selected = rows.find((row) => row.caseId === caseId);
  const members = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  return <section className="stats-section"><div className="section-heading"><div><h2>{family.toUpperCase()} cases</h2><p>{skipCount} skips · {model.analysisCount ? (skipCount / model.analysisCount * 100).toFixed(1) : "—"}% of analysed solves</p></div></div>
    <p className="small faint">{RECOGNITION_NOTE}</p>
    <div className="statistics-controls"><label className="field">{family.toUpperCase()} case sort<select value={sort} onChange={(e) => setSort(e.target.value as CaseSort)}>{(["case", "count", "median", "recognition", "execution", "tps"] as const).map((key) => <option key={key} value={key}>{{ case: "Case", count: "Samples", median: "Median", recognition: "Measured recognition", execution: "Measured execution", tps: "Execution TPS" }[key]}</option>)}</select></label><label className="field">Direction<select value={direction} onChange={(e) => setDirection(e.target.value as SortDirection)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>
    {rows.length ? <PerformanceTable rows={sorted} onSelect={(row) => setCaseId((row as CasePerformance).caseId)} /> : <div className="chart-empty">No recognised non-skipped {family.toUpperCase()} cases in this scope.</div>}
    {selected ? <div className="stats-detail" role="region" aria-label={`${family.toUpperCase()} case solves`}>
      <div className="section-heading"><h3>{family.toUpperCase()} {selected.caseId} · {selected.count} solves</h3><div className="row"><button onClick={() => onTrainCase(family, selected.caseId)}>Train case</button><button className="ghost" onClick={() => setCaseId(null)}>Close case</button></div></div>
      <div className="table-scroll"><table className="stats-table"><thead><tr><th>Solve</th><th>Session</th><th>Date</th></tr></thead><tbody>{selected.solveIds.map((id) => {
        const solve = members.get(id);
        return solve ? <tr key={id} {...statisticsActivationProps(() => onOpenSolve(solve), `View solve ${formatSolveTime(solve)} · ${new Date(solve.createdAt).toLocaleString()}`)}><td><button className="ghost small stats-open-link" onClick={() => onOpenSolve(solve)}>{formatSolveTime(solve)}</button></td><td>{model.eventSessions.find((session) => session.id === solve.sessionId)?.name}</td><td>{new Date(solve.createdAt).toLocaleString()}</td></tr> : null;
      })}</tbody></table></div>
    </div> : null}
  </section>;
}

export function StatisticsF2lPerformance({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const [position, setPosition] = useState<string | null>(null);
  const [mode, setMode] = useState<"slot" | "order">("slot");
  const rows = mode === "slot" ? model.f2lSlots : model.f2lPositions;
  const selected = rows.find((row) => row.label === position);
  const members = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  return <section className="stats-section">
    <div className="section-heading"><div><h2>F2L performance</h2><p>{mode === "slot" ? "Solver-relative F2L slot · skipped/XCross pairs counted separately" : "Pair completion order · skipped/XCross pairs counted separately"}</p></div></div>
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
            {model.sessionId === null ? <td>{model.eventSessions.find((session) => session.id === solve.sessionId)?.name}</td> : null}<td>{new Date(solve.createdAt).toLocaleString()}</td>
          </tr> : null;
        })}</tbody>
      </table></div> : <div className="chart-empty">No non-skipped samples for this position.</div>}
    </div> : null}
  </section>;
}

export function StatisticsAnalysisTables({ model, onOpenSolve, onTrainCase }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void; onTrainCase: (family: LastLayerFamily, caseId: string) => void }) {
  return <>
    <StatisticsF2lPerformance model={model} onOpenSolve={onOpenSolve} />
    <StatisticsCaseTable family="oll" rows={model.ollCases} skipCount={model.ollSkips} model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} />
    <StatisticsCaseTable family="pll" rows={model.pllCases} skipCount={model.pllSkips} model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} />
  </>;
}

export function StatisticsPauses({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const pauses = model.pauses;
  const longestSolve = model.scopeSolves.find((solve) => solve.id === pauses?.longest?.solveId);
  return (
    <section className="stats-section"><div className="section-heading"><div><h2>Pauses</h2><p>Gaps ≥250 ms, attributed to the phase containing the next raw move. Pre-first-turn planning is unmeasured.</p></div></div>
      {pauses ? <>
        <div className="stat-grid">{[
          ["Mean pauses per solve", pauses.meanCount.toFixed(2)], ["Mean individual pause", formatTime(pauses.meanDurationMs)],
          ["Mean total pause time", formatTime(pauses.meanTotalMs)], ["Pause-free solves", `${pauses.pauseFreeCount} / ${pauses.sampleSize} (${(pauses.pauseFreeShare * 100).toFixed(1)}%)`],
        ].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <p>Longest pause: {longestSolve ? <button className="ghost small stats-open-link" onClick={() => onOpenSolve(longestSolve)}>{formatTime(pauses.longest?.durationMs)} · View solve {formatSolveTime(longestSolve)}</button> : "—"}</p>
        <div className="table-scroll"><table className="stats-table"><thead><tr><th>Phase</th><th>Total pause time</th><th>Share of pauses</th></tr></thead><tbody>{pauses.phases.map((phase) => <tr key={phase.name}><td>{phase.name}</td><td>{formatTime(phase.totalMs)}</td><td>{(phase.share * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
      </> : <div className="chart-empty">Pause analytics need usable CFOP analysis.</div>}
    </section>
  );
}

export function StatisticsConsistency({ model }: { model: StatisticsViewModel }) {
  const consistency = model.consistency;
  return (
    <section className="stats-section"><div className="section-heading"><div><h2>Consistency</h2><p>Finished effective times · full selected scope</p></div></div>
      <div className="stat-grid">{[
        ["Best Single", formatTime(consistency.pbMs)], ["Median", formatTime(consistency.medianMs)],
        ["PB vs median gap", `${formatTime(consistency.gapMs)}${consistency.gapShare === undefined ? "" : ` (${(consistency.gapShare * 100).toFixed(1)}% of median)`}`],
        ["Middle 50% · P25 → P75", `${formatTime(consistency.p25Ms)} → ${formatTime(consistency.p75Ms)}`],
        ["Middle 80% · P10 → P90", `${formatTime(consistency.p10Ms)} → ${formatTime(consistency.p90Ms)}`],
      ].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    </section>
  );
}
