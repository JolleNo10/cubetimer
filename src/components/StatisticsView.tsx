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
import { effectiveMs } from "../state/types";
import { formatTime, type LongAverage } from "../state/stats";
import { CfopPhaseTrendChart, DistributionChart, SolveTimeTrendChart } from "./StatisticsCharts";

function value(value: number | null | undefined): string {
  return formatTime(value);
}

function LongAverageCard({ average, finishedCount }: { average: LongAverage; finishedCount: number }) {
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
      <small>{detail}</small>
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
        <StatCard label="Mean recognition" value={formatTime(analysis.meanRecognitionMs)} />
        <StatCard label="Analysis coverage" value={`${Math.round(model.analysisCoverage * 100)}%`} detail={`${model.analysisCount} / ${model.stats.solved} finished`} />
      </div>
      <div className="recognition-split" aria-label="Recognition versus execution time">
        <div className="split-bar">
          <span className="recognition" style={{ width: `${analysis.recognitionShare * 100}%` }} />
          <span className="execution" style={{ width: `${analysis.executionShare * 100}%` }} />
        </div>
        <div className="split-legend">
          <span><i className="swatch recognition" />Recognition {formatTime(analysis.recognitionMs)} ({Math.round(analysis.recognitionShare * 100)}%)</span>
          <span><i className="swatch execution" />Execution {formatTime(analysis.executionMs)} ({Math.round(analysis.executionShare * 100)}%)</span>
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

export function StatisticsView({ currentEvent, activeSessionId }: { currentEvent: EventId; activeSessionId: string | null }) {
  const controller = useController();
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [event, setEvent] = useState<EventId>(currentEvent || DEFAULT_EVENT_ID);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chartWindow, setChartWindow] = useState<ChartWindow>(100);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const selectedEvent = eventInfo(event);
  const scopeLabel = model?.sessionId
    ? model.eventSessions.find((session) => session.id === model.sessionId)?.name ?? "Session"
    : `All sessions · ${selectedEvent.name}`;
  const visibleTrend = model ? sliceChartWindow(model.trend, chartWindow) : [];
  const visiblePhases = model ? filterPhaseChartWindow(model.phaseTrend, visibleTrend, chartWindow) : [];

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
          <label className="field">Chart window<select value={chartWindow} onChange={(e) => setChartWindow(e.target.value === "all" ? "all" : Number(e.target.value) as ChartWindow)}>
            <option value={50}>Last 50</option><option value={100}>Last 100</option><option value={250}>Last 250</option><option value="all">All</option>
          </select></label>
          <button className="ghost" onClick={refresh} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {loading ? <div className="empty stats-loading">Loading statistics…</div> : null}
      {error ? <div className="notice error"><span className="grow">Could not load statistics: {error}</span><button className="ghost" onClick={refresh}>Retry</button></div> : null}
      {!loading && !error && model ? (
        <>
          {model.ignoredSolveCount ? <div className="notice">{model.ignoredSolveCount} solve{model.ignoredSolveCount === 1 ? "" : "s"} could not be assigned to a known Session and {model.ignoredSolveCount === 1 ? "was" : "were"} omitted.</div> : null}
          {!model.eventSessions.length ? <div className="empty">No Sessions exist for this event.</div> : null}
          <section className="stats-section">
            <div className="section-heading"><div><h2>Overview</h2><p>{scopeLabel} · summaries use the full selected scope</p></div></div>
            <div className="stat-grid overview-grid">
              <StatCard label="Counted solves" value={String(model.stats.count)} detail={`${model.stats.solved} finished · ${model.dnfCount} DNF`} />
              <StatCard label="Best" value={value(model.stats.best)} />
              <StatCard label="Median" value={value(model.medianMs)} />
              <StatCard label="Mean finished" value={value(model.meanFinishedMs)} />
              <StatCard label="Ao5" value={value(model.stats.ao5)} detail={model.stats.bestAo5 === undefined ? undefined : `Best ${value(model.stats.bestAo5)}`} />
              <StatCard label="Ao12" value={value(model.stats.ao12)} detail={model.stats.bestAo12 === undefined ? undefined : `Best ${value(model.stats.bestAo12)}`} />
              <LongAverageCard average={model.stats.ao50} finishedCount={model.stats.solved} />
              <LongAverageCard average={model.stats.ao100} finishedCount={model.stats.solved} />
              <StatCard label="DNF rate" value={`${Math.round(model.dnfRate * 100)}%`} detail={`${model.dnfCount} of ${model.stats.count}`} />
              <StatCard label="P25 / P75" value={`${value(model.p25Ms)} / ${value(model.p75Ms)}`} />
              <StatCard label="P90" value={value(model.p90Ms)} />
              <StatCard label="Best Ao50 / Ao100" value={`${value(model.bestAo50)} / ${value(model.bestAo100)}`} />
            </div>
          </section>

          <section className="stats-section trend-section">
            <div className="section-heading"><div><h2>Solve time trend</h2><p>{scopeLabel} · showing {chartWindow === "all" ? "all" : `the last ${chartWindow}`} counted solves</p></div></div>
            <SolveTimeTrendChart points={visibleTrend} scopeLabel={scopeLabel} />
          </section>

          <div className="stats-two-column">
            <section className="stats-section"><div className="section-heading"><div><h2>Distribution</h2><p>Finished solves only · {model.distribution.dnfCount} DNFs excluded from bins</p></div></div><DistributionChart distribution={model.distribution} /></section>
            <section className="stats-section"><div className="section-heading"><div><h2>CFOP phase summary</h2><p>Median phase times</p></div></div><PhaseSummary model={model} /></section>
          </div>

          <section className="stats-section"><div className="section-heading"><div><h2>Analysis</h2><p>Canonical analysed normal solves</p></div></div><AnalysisSection model={model} /></section>
          {model.phaseTrend.length ? <section className="stats-section"><div className="section-heading"><div><h2>CFOP phase trend</h2><p>Rolling median over up to the latest 10 analysed solves</p></div></div><CfopPhaseTrendChart points={visiblePhases} scopeLabel={scopeLabel} emptyMessage="No analysed solves in this chart window." /></section> : null}

          <section className="stats-section"><div className="section-heading"><div><h2>Session comparison</h2><p>Click a row to filter Statistics only; the Timer Session stays unchanged.</p></div></div><SessionTable model={model} onSelect={setSessionId} /></section>
        </>
      ) : null}
    </main>
  );
}
