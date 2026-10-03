import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_EVENT_ID, eventInfo, type EventId } from "../cube/scramble";
import { useController } from "../hooks/useController";
import {
  availableStatisticsEvents,
  deriveStatistics,
  filterPhaseChartWindow,
  sliceChartWindow,
  type ChartWindow,
  type StatisticsSnapshot,
  type StatisticsViewModel,
} from "../state/statistics";
import { effectiveMs, type Solve } from "../state/types";
import { formatTime, type LongAverage } from "../state/stats";
import { AverageProgressionChart, RecognitionExecutionTrendChart, CfopPhaseTrendChart, DistributionChart, SolveTimeTrendChart } from "./StatisticsCharts";
import { StatisticsRecords, StatisticsCfopRecords, StatisticsBestSplits } from "./StatisticsRecords";
import { StatisticsAnalysisTables, StatisticsConsistency, StatisticsPauses } from "./StatisticsAnalysisTables";
import { StatisticsSolveDetail } from "./StatisticsSolveDetail";
import { RECOGNITION_NOTE } from "../state/statistics";
import type { LastLayerFamily } from "../cube/lastLayerTraining";

function value(value: number | null | undefined): string {
  return formatTime(value);
}

function LongAverageCard({ average, finishedCount, best }: { average: LongAverage; finishedCount: number; best?: number }) {
  const label = average.status === "projected" ? `Projected Ao${average.size}` : `Ao${average.size}`;
  const detail = average.status === "projected"
    ? `Recent-median projection · ${average.count} / ${average.size} · ${average.size - average.count} remaining`
    : average.status === "actual"
      ? `${average.size}-solve average`
      : finishedCount < 10
        ? "Needs 10 finished solves for a projection"
        : "Unavailable";
  return (
    <div className={`stat-card average-${average.status}`} title={average.status === "projected" ? "Remaining solves are assumed at the median of the latest up-to-20 finished counted solves." : undefined}>
      <span className="stat-label">{label}</span>
      <strong>{value(average.value)}</strong>
      <small>{detail} · Best {value(best)}</small>
    </div>
  );
}

function StatCard({ label, value: cardValue, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong>{cardValue}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function AnalysisSection({ model }: { model: StatisticsViewModel }) {
  const analysis = model.recognitionExecution;
  if (!analysis) {
    return <div className="chart-empty">No usable CFOP analysis is available for this scope.</div>;
  }
  return (
    <div className="analysis-grid">
      <div className="analysis-metrics">
        <StatCard label="Mean moves" value={analysis.meanMoves.toFixed(1)} />
        <StatCard label="Aggregate TPS" value={analysis.aggregateTps.toFixed(2)} />
        <StatCard label="Mean measured recognition" value={formatTime(analysis.meanRecognitionMs)} />
        <StatCard label="Analysis coverage" value={`${Math.round(model.analysisCoverage * 100)}%`} detail={`${model.analysisCount} / ${model.stats.solved} finished`} />
        <StatCard label="Median measured recognition" value={formatTime(analysis.medianRecognitionMs)} />
        <StatCard label="Median measured execution" value={formatTime(analysis.medianExecutionMs)} />
        <StatCard label="Median F2L recognition" value={formatTime(analysis.medianF2lRecognitionMs)} />
        <StatCard label="Median OLL recognition" value={formatTime(analysis.medianOllRecognitionMs)} />
        <StatCard label="Median PLL recognition" value={formatTime(analysis.medianPllRecognitionMs)} />
        <StatCard label="Median recognition share per solve" value={`${(analysis.medianRecognitionShare * 100).toFixed(1)}%`} />
        <StatCard label="Median measured execution share per solve" value={`${(analysis.medianExecutionShare * 100).toFixed(1)}%`} />
      </div>
      <div className="recognition-split" aria-label="Measured recognition, measured execution and unclassified time">
        <p className="small faint">Measured segments and unclassified/opening time sum to analysed solving time.</p>
        <div className="split-bar">
          <span className="recognition" style={{ width: `${analysis.recognitionShare * 100}%` }} />
          <span className="execution" style={{ width: `${analysis.executionShare * 100}%` }} />
          <span className="unclassified" style={{ width: `${analysis.unclassifiedShare * 100}%` }} />
        </div>
        <div className="split-legend">
          <span><i className="swatch recognition" />Measured recognition {formatTime(analysis.recognitionMs)} ({Math.round(analysis.recognitionShare * 100)}%)</span>
          <span><i className="swatch execution" />Measured execution {formatTime(analysis.executionMs)} ({Math.round(analysis.executionShare * 100)}%)</span>
          <span><i className="swatch unclassified" />Unclassified/opening time {formatTime(analysis.unclassifiedMs)} ({Math.round(analysis.unclassifiedShare * 100)}%)</span>
        </div>
      </div>
    </div>
  );
}

function PhaseSummary({ model }: { model: StatisticsViewModel }) {
  if (!model.cfop?.length) return <div className="chart-empty">No usable CFOP analysis in this scope.</div>;
  const max = Math.max(...model.cfop.map((phase) => phase.timeMs), 1);
  return (
    <div className="phase-summary">
      {model.cfop.map((phase) => (
        <div className="phase-row" key={phase.name}>
          <span>{phase.name}</span>
          <div className="phase-track"><span style={{ width: `${phase.timeMs / max * 100}%` }} /></div>
          <strong>{formatTime(phase.timeMs)}</strong>
        </div>
      ))}
    </div>
  );
}

function SessionTable({ model, onSelect }: { model: StatisticsViewModel; onSelect: (id: string) => void }) {
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead><tr><th>Session</th><th>Counted</th><th>Best</th><th>Median</th><th>Ao5</th><th>Ao12</th><th>DNF %</th><th>Last solve</th></tr></thead>
        <tbody>
          {model.sessionComparison.map((row) => (
            <tr
              key={row.session.id}
              className={`${row.current ? "current " : ""}${model.sessionId === row.session.id ? "selected" : ""}`}
              onClick={() => onSelect(row.session.id)}
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row.session.id); }}
            >
              <td><span>{row.session.name}</span>{row.current ? <small>current</small> : null}</td>
              <td>{row.stats.count}</td>
              <td>{value(row.stats.best)}</td>
              <td>{value(row.medianMs)}</td>
              <td>{value(row.stats.ao5)}</td>
              <td>{value(row.stats.ao12)}</td>
              <td>{Math.round(row.dnfRate * 100)}%</td>
              <td>{row.lastSolve ? value(effectiveMs(row.lastSolve)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const STATISTICS_VIEWS = ["Overview", "Solves", "CFOP", "Cases"] as const;
export type StatisticsSubview = typeof STATISTICS_VIEWS[number];

export function StatisticsNavigation({ view, onSelect }: { view: StatisticsSubview; onSelect: (view: StatisticsSubview) => void }) {
  return <nav className="statistics-navigation" aria-label="Statistics views">{STATISTICS_VIEWS.map((item) => <button key={item} className="ghost" aria-pressed={view === item} onClick={() => onSelect(item)}>{item}</button>)}</nav>;
}

export function StatisticsOverviewSummary({ model }: { model: StatisticsViewModel }) {
  const allSessions = model.sessionId === null;
  return <div className="stat-grid overview-grid">
    <StatCard label="Counted solves" value={String(model.stats.count)} detail={`${model.stats.solved} finished · ${model.dnfCount} DNF`} />
    <StatCard label="Best Single" value={value(model.stats.best)} />
    <StatCard label="Median" value={value(model.medianMs)} />
    {([5, 12, 50, 100] as const).map((size) => {
      const metric = `ao${size}` as const;
      const best = model.records[metric][0]?.value;
      if (!allSessions && (size === 50 || size === 100)) return <LongAverageCard key={size} average={model.stats[`ao${size}`]} finishedCount={model.stats.solved} best={best} />;
      const latest = model.latestAverages[metric];
      const source = latest ? model.eventSessions.find((session) => session.id === latest.sessionId)?.name : undefined;
      const current = size === 5 ? model.stats.ao5 : size === 12 ? model.stats.ao12 : latest?.window.value;
      return <StatCard key={size} label={`${allSessions ? "Latest " : ""}Ao${size}`} value={value(current)} detail={`${allSessions ? source ? `${source} · ` : "No achieved window · " : ""}Best ${value(best)}`} />;
    })}
    <StatCard label="TPS" value={model.recognitionExecution?.aggregateTps.toFixed(2) ?? "—"} detail="Whole solve · analysed solves" />
    <StatCard label="DNF rate" value={`${Math.round(model.dnfRate * 100)}%`} detail={`${model.dnfCount} of ${model.stats.count}`} />
  </div>;
}

export function StatisticsView({ currentEvent, activeSessionId, onReplay, onTools, onTrainCase, onScopeChange }: {
  currentEvent: EventId; activeSessionId: string | null;
  onReplay: (solve: Solve) => void; onTools: (solve: Solve) => void;
  onTrainCase: (family: LastLayerFamily, caseId: string) => void;
  onScopeChange: (solveIds: readonly string[]) => void;
}) {
  const controller = useController();
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [event, setEvent] = useState<EventId>(currentEvent || DEFAULT_EVENT_ID);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chartWindow, setChartWindow] = useState<ChartWindow>(100);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSolve, setDetailSolve] = useState<Solve | null>(null);
  const [view, setView] = useState<StatisticsSubview>("Overview");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void controller.loadStatisticsSnapshot().then((loaded) => {
      if (!active) return;
      setSnapshot(loaded);
    }).catch((loadError: unknown) => {
      if (active) setError(String(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [controller, refreshToken]);

  const eventOptions = useMemo(() => snapshot ? availableStatisticsEvents(snapshot) : [], [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const resolvedEvent = eventOptions.includes(event) ? event : eventOptions[0] ?? currentEvent ?? DEFAULT_EVENT_ID;
    setEvent(resolvedEvent);
    setSessionId((current) => {
      const selected = snapshot.sessions.find((session) => session.id === current);
      return selected?.event === resolvedEvent ? current : null;
    });
  }, [snapshot, eventOptions, event, currentEvent]);

  const model = useMemo(() => {
    if (!snapshot) return null;
    const matching = snapshot.sessions.some((candidate) => candidate.id === sessionId && candidate.event === event);
    const safeSessionId = matching ? sessionId : null;
    return deriveStatistics(snapshot, { event, sessionId: safeSessionId }, activeSessionId);
  }, [event, sessionId, snapshot, activeSessionId]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);
  useEffect(() => {
    if (!model) return;
    const ids = model.scopeSolves.map((solve) => solve.id);
    setDetailSolve((current) => current ? model.scopeSolves.find((solve) => solve.id === current.id) ?? null : null);
    onScopeChange(ids);
  }, [model, onScopeChange]);
  const selectedEvent = eventInfo(event);
  const scopeLabel = model?.sessionId
    ? model.eventSessions.find((session) => session.id === model.sessionId)?.name ?? "Session"
    : `All sessions · ${selectedEvent.name}`;
  const visibleTrend = model ? sliceChartWindow(model.trend, chartWindow) : [];
  const visiblePhases = model ? filterPhaseChartWindow(model.phaseTrend, visibleTrend, chartWindow) : [];
  const visibleAverages = model ? filterPhaseChartWindow(model.averageProgression, visibleTrend, chartWindow) : [];
  const visibleRecognition = model ? filterPhaseChartWindow(model.recognitionTrend, visibleTrend, chartWindow) : [];

  return (
    <main className="statistics-page">
      <div className="statistics-toolbar">
        <div>
          <h1>Statistics</h1>
          <p>{model ? `${model.stats.count} counted solves · ${model.analysisCount} analysed` : "Historical solve analytics"}</p>
        </div>
        <div className="statistics-controls">
          <label className="field">Event<select value={event} onChange={(e) => { setEvent(e.target.value as EventId); setSessionId(null); }} disabled={!eventOptions.length}>
            {eventOptions.map((id) => <option key={id} value={id}>{eventInfo(id).name}</option>)}
          </select></label>
          <label className="field">Session<select value={model?.sessionId ?? "all"} onChange={(e) => setSessionId(e.target.value === "all" ? null : e.target.value)} disabled={!model?.eventSessions.length}>
            <option value="all">All sessions</option>
            {model?.eventSessions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select></label>
          <button className="ghost" onClick={refresh} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      <StatisticsNavigation view={view} onSelect={setView} />

      {loading ? <div className="empty stats-loading">Loading statistics…</div> : null}
      {error ? <div className="notice error"><span className="grow">Could not load statistics: {error}</span><button className="ghost" onClick={refresh}>Retry</button></div> : null}
      {!loading && !error && model ? (
        <>
          {model.ignoredSolveCount ? <div className="notice">{model.ignoredSolveCount} solve{model.ignoredSolveCount === 1 ? "" : "s"} could not be assigned to a known Session and {model.ignoredSolveCount === 1 ? "was" : "were"} omitted.</div> : null}
          {!model.eventSessions.length ? <div className="empty">No Sessions exist for this event.</div> : null}
          {view === "Overview" || view === "CFOP" ? <div className="statistics-controls chart-window-controls">
          <label className="field">Chart window<select value={chartWindow} onChange={(e) => setChartWindow(e.target.value === "all" ? "all" : Number(e.target.value) as ChartWindow)}>
            <option value={50}>Last 50</option><option value={100}>Last 100</option><option value={250}>Last 250</option><option value="all">All</option>
          </select></label>
          </div> : null}
          {view === "Overview" ? <>
          <section className="stats-section">
            <div className="section-heading"><div><h2>Overview</h2><p>{scopeLabel} · summaries use the full selected scope</p></div></div>
            <StatisticsOverviewSummary model={model} />
          </section>

          <section className="stats-section trend-section">
            <div className="section-heading"><div><h2>Solve time trend</h2><p>{scopeLabel} · showing {chartWindow === "all" ? "all" : `the last ${chartWindow}`} counted solves · select a point to review its solve</p></div></div>
            <SolveTimeTrendChart points={visibleTrend} scopeLabel={scopeLabel} onOpenSolve={(id) => { const solve = model.scopeSolves.find((solve) => solve.id === id); if (solve) setDetailSolve(solve); }} />
          </section>
          <section className="stats-section"><div className="section-heading"><div><h2>Average progression</h2><p>Actual Ao5/Ao12/Ao50/Ao100 windows · chart window controls presentation only</p></div></div><AverageProgressionChart points={visibleAverages} scopeLabel={scopeLabel} /></section>

          <div className="stats-two-column">
            <section className="stats-section"><div className="section-heading"><div><h2>Distribution</h2><p>Finished solves only · {model.distribution.dnfCount} DNFs excluded from bins</p></div></div><DistributionChart distribution={model.distribution} /></section>
            <StatisticsConsistency model={model} />
          </div>

          {model.sessionId === null || model.eventSessions.length > 1 ? <section className="stats-section"><div className="section-heading"><div><h2>Session comparison</h2><p>Click a row to filter Statistics only; the Timer Session stays unchanged.</p></div></div><SessionTable model={model} onSelect={setSessionId} /></section> : null}
          </> : null}
          {view === "Solves" ? <StatisticsRecords key={`records:${model.event}:${model.sessionId ?? "all"}`} model={model} onOpenSolve={setDetailSolve} /> : null}
          {view === "CFOP" ? <>
          <section className="stats-section"><div className="section-heading"><div><h2>CFOP phase summary</h2><p>Median phase times</p></div></div><PhaseSummary model={model} /></section>
          <section className="stats-section"><div className="section-heading"><div><h2>Analysis</h2><p>Canonical analysed normal solves · {RECOGNITION_NOTE}</p></div></div><AnalysisSection model={model} /></section>
          <section className="stats-section"><div className="section-heading"><div><h2>Measured recognition / execution trend</h2><p>Rolling median over up to the latest 10 analysed solves · {RECOGNITION_NOTE}</p></div></div><RecognitionExecutionTrendChart points={visibleRecognition} scopeLabel={scopeLabel} /></section>
          {model.phaseTrend.length ? <section className="stats-section"><div className="section-heading"><div><h2>CFOP phase trend</h2><p>Rolling median over up to the latest 10 analysed solves</p></div></div><CfopPhaseTrendChart points={visiblePhases} scopeLabel={scopeLabel} emptyMessage="No analysed solves in this chart window." /></section> : null}

          <StatisticsCfopRecords key={`cfop:${model.event}:${model.sessionId ?? "all"}`} model={model} onOpenSolve={setDetailSolve} />
          <StatisticsPauses model={model} onOpenSolve={setDetailSolve} />
          <StatisticsBestSplits model={model} onOpenSolve={setDetailSolve} />
          </> : null}
          {view === "Cases" ? <StatisticsAnalysisTables key={`analysis:${model.event}:${model.sessionId ?? "all"}`} model={model} onOpenSolve={setDetailSolve} onTrainCase={onTrainCase} /> : null}
        </>
      ) : null}
      {detailSolve && model?.scopeSolves.some((solve) => solve.id === detailSolve.id) ? <StatisticsSolveDetail solve={detailSolve} solves={model.scopeSolves} session={model.eventSessions.find((session) => session.id === detailSolve.sessionId)} onClose={() => setDetailSolve(null)} onReplay={onReplay} onTools={onTools} /> : null}
    </main>
  );
}
