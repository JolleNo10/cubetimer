import { applySolveThreshold } from "../state/solveThreshold";
import { formatTime } from "../../../shared/time";
import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_EVENT_ID, eventInfo, type EventId } from "../../../cube/scramble";
import { useController, useSettings } from "../../../app/useController";
import {
  availableStatisticsEvents,
  chartWindowSeries,
  deriveStatistics,
  RECOGNITION_NOTE,
  type AverageStanding,
  type ChartWindow,
  type StatisticsSnapshot,
  type StatisticsViewModel,
} from "../state/statistics";
import { effectiveMs, type Solve } from "../../../app/types";
import { AverageProgressionChart, RecognitionExecutionTrendChart, CfopPhaseTrendChart, DistributionChart, SolveTimeTrendChart } from "./StatisticsCharts";
import { StatisticsRecords, StatisticsCfopRecords, StatisticsPhaseTable } from "./StatisticsRecords";
import { StatisticsAnalysisTables, StatisticsConsistency, StatisticsPauses } from "./StatisticsAnalysisTables";
import { StatisticsSolveDetail } from "./StatisticsSolveDetail";
import { ChartWindowSelect, Delta, DeltaCard, SegmentedControl, SplitBar, StatCard, StatsSection } from "./StatisticsPrimitives";
import { statisticsActivationProps } from "./statisticsInteraction";
import type { LastLayerFamily } from "../../../cube/lastLayerTraining";

type ChartSeries = ReturnType<typeof chartWindowSeries>;
type SessionNames = ReadonlyMap<string, string>;

function value(value: number | null | undefined): string {
  return formatTime(value);
}

function averageCard(standing: AverageStanding, model: StatisticsViewModel) {
  const allSessions = model.sessionId === null;
  const { size, status } = standing;
  const best = `Best ${value(standing.bestMs)}`;
  if (allSessions) {
    const source = model.eventSessions.find((session) => session.id === standing.sourceSessionId)?.name;
    return <StatCard key={size} label={`Latest Ao${size}`} value={value(standing.value)} tone={standing.isBest ? "pb" : status === "unavailable" ? "unavailable" : undefined}
      detail={`${source ? `${source} · ` : "No achieved window · "}${best}`} />;
  }
  if (status === "projected") {
    return <StatCard key={size} label={`Projected Ao${size}`} value={value(standing.value)} tone="projected"
      title="Remaining solves are assumed at the median of the latest up-to-20 finished counted solves."
      detail={`${standing.count} / ${size} solves · ${best}`} />;
  }
  if (status === "unavailable") {
    const detail = size >= 50 && model.stats.solved < 10 ? "Needs 10 finished solves for a projection" : `Needs ${size} counted solves`;
    return <StatCard key={size} label={`Ao${size}`} value={value(standing.value)} tone="unavailable" detail={`${detail} · ${best}`} />;
  }
  return <StatCard key={size} label={`Ao${size}`} value={value(standing.value)} tone={standing.isBest ? "pb" : undefined}
    detail={standing.isBest ? `Personal best · ${best}` : <>{best} · <Delta ms={standing.deltaToBestMs} /></>} />;
}

export function StatisticsOverviewSummary({ model }: { model: StatisticsViewModel }) {
  const { dateOnly } = useDateTimeFormat();
  const single = model.records.single[0];
  const singleSession = single ? model.eventSessions.find((session) => session.id === single.sessionId)?.name : undefined;
  return <div className="kpi-grid overview-summary">
    <StatCard label="Counted solves" value={String(model.stats.count)} detail={`${model.stats.solved} finished · ${model.dnfCount} DNF (${Math.round(model.dnfRate * 100)}%)`} />
    <StatCard label="Best single" value={value(model.stats.best)} detail={single ? `${dateOnly(single.createdAt)}${model.sessionId === null && singleSession ? ` · ${singleSession}` : ""}` : undefined} />
    <StatCard label="Median" value={value(model.medianMs)} detail={model.meanFinishedMs === undefined ? undefined : `Mean of finished ${value(model.meanFinishedMs)}`} />
    {(["ao5", "ao12", "ao50", "ao100"] as const).map((metric) => averageCard(model.averageStandings[metric], model))}
  </div>;
}

export function StatisticsRecentForm({ model }: { model: StatisticsViewModel }) {
  const form = model.recentForm;
  return <StatsSection id="recent-form" title="Recent form" description={form ? `Latest ${form.sampleSize} counted solves vs the ${form.sampleSize} before · medians of finished results` : undefined}>
    {form ? <div className="kpi-grid">
      <DeltaCard label="Recent median" value={value(form.recentMedianMs)} deltaMs={form.medianDeltaMs} detail={`vs ${value(form.baselineMedianMs)}`} />
      <DeltaCard label="Recent spread (IQR)" value={value(form.recentIqrMs)} deltaMs={form.iqrDeltaMs} detail="narrower is more consistent" />
      <StatCard label="Recent DNFs" value={`${form.recentDnfCount} / ${form.sampleSize}`} tone={form.recentDnfCount > form.baselineDnfCount ? "warn" : form.recentDnfCount < form.baselineDnfCount ? "good" : undefined}
        detail={`${form.baselineDnfCount} in the previous window`} />
    </div> : <p className="small dim">Needs at least 10 counted solves, with three finished in each half.</p>}
  </StatsSection>;
}

export function SessionTable({ model, onSelect }: { model: StatisticsViewModel; onSelect: (id: string) => void }) {
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead><tr><th>Session</th><th>Counted</th><th>Best</th><th>Median</th><th>Ao5</th><th>Best Ao5</th><th>Ao12</th><th>DNF %</th><th>Last solve</th></tr></thead>
        <tbody>
          {model.sessionComparison.map((row) => (
            <tr
              key={row.session.id}
              className={`${row.current ? "current " : ""}${model.sessionId === row.session.id ? "selected" : ""}`}
              aria-current={model.sessionId === row.session.id ? "true" : undefined}
              {...statisticsActivationProps(() => onSelect(row.session.id), `Show statistics for ${row.session.name}`)}
            >
              <td><span>{row.session.name}</span>{row.current ? <small>current</small> : null}</td>
              <td className="number">{row.stats.count}</td>
              <td className="number">{value(row.stats.best)}</td>
              <td className="number">{value(row.medianMs)}</td>
              <td className="number">{value(row.stats.ao5)}</td>
              <td className="number">{value(row.stats.bestAo5)}</td>
              <td className="number">{value(row.stats.ao12)}</td>
              <td className="number">{Math.round(row.dnfRate * 100)}%</td>
              <td className="number">{row.lastSolve ? value(effectiveMs(row.lastSolve)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TabProps = {
  model: StatisticsViewModel; series: ChartSeries; chartWindow: ChartWindow; onChartWindowChange: (window: ChartWindow) => void;
  scopeLabel: string; sessionNames?: SessionNames; onOpenSolveId: (solveId: string) => void;
};

export function StatisticsOverview({ model, series, chartWindow, onChartWindowChange, scopeLabel, sessionNames, onOpenSolveId, onSelectSession }: TabProps & { onSelectSession: (id: string) => void }) {
  const [chart, setChart] = useState<"times" | "averages">("times");
  return <>
    <StatisticsOverviewSummary model={model} />
    <StatisticsRecentForm model={model} />
    <StatsSection id="progress" title="Progress" className="trend-section"
      description={`${chart === "times" ? "Singles with Ao5/Ao12" : "Actual Ao5–Ao100 windows"} · ${chartWindow === "all" ? "all" : `last ${chartWindow}`} counted solves · select a point to review its solve`}
      actions={<><SegmentedControl label="Progress chart" value={chart} onChange={setChart} options={[{ value: "times", label: "Solve times" }, { value: "averages", label: "Averages" }]} /><ChartWindowSelect value={chartWindow} onChange={onChartWindowChange} /></>}>
      {chart === "times"
        ? <SolveTimeTrendChart points={series.trend} scopeLabel={scopeLabel} sessionNames={sessionNames} onOpenSolve={onOpenSolveId} />
        : <AverageProgressionChart points={series.averages} scopeLabel={scopeLabel} sessionNames={sessionNames} onOpenSolve={onOpenSolveId} />}
    </StatsSection>
    <StatsSection id="distribution" title="Distribution" description={`Finished solves in the full scope · ${model.distribution.dnfCount} DNF${model.distribution.dnfCount === 1 ? "" : "s"} excluded`}>
      <div className="distribution-layout">
        <DistributionChart distribution={model.distribution} band={model.consistency} />
        <StatisticsConsistency model={model} />
      </div>
    </StatsSection>
    {model.sessionId === null || model.eventSessions.length > 1 ? <StatsSection id="sessions" title="Sessions" description="Select a row to filter Statistics; the Timer Session stays unchanged.">
      <SessionTable model={model} onSelect={onSelectSession} />
    </StatsSection> : null}
  </>;
}

export function CfopSummary({ model }: { model: StatisticsViewModel }) {
  const analysis = model.recognitionExecution;
  if (!analysis) return <div className="chart-empty">No usable CFOP analysis is available for this scope.</div>;
  const recent = model.recentPerformance;
  return <>
    <div className="kpi-grid">
      <StatCard label="Analysed" value={`${Math.round(model.analysisCoverage * 100)}%`} detail={`${model.analysisCount} / ${model.stats.solved} finished`} />
      <StatCard label="Moves (STM)" value={analysis.meanMoves.toFixed(1)} detail="Mean per solve" />
      <StatCard label="TPS" value={analysis.aggregateTps.toFixed(2)} detail="Whole solve" />
      <StatCard label="Recognition" value={value(analysis.medianRecognitionMs)} detail={<>{(analysis.medianRecognitionShare * 100).toFixed(0)}% of solve{recent ? <> · <Delta ms={recent.recognitionDelta} /></> : null}</>} />
      <StatCard label="Execution" value={value(analysis.medianExecutionMs)} detail={<>{(analysis.medianExecutionShare * 100).toFixed(0)}% of solve{recent ? <> · <Delta ms={recent.executionDelta} /></> : null}</>} />
      <StatCard label="Unclassified" value={`${(analysis.unclassifiedShare * 100).toFixed(1)}%`} detail="Opening and unmeasured time" />
    </div>
    <SplitBar label="Measured recognition, measured execution and unclassified time" segments={[
      { series: "recognition", label: "Recognition", share: analysis.recognitionShare },
      { series: "execution", label: "Execution", share: analysis.executionShare },
      { series: "unclassified", label: "Unclassified", share: analysis.unclassifiedShare },
    ]} />
  </>;
}

export function StatisticsCfop({ model, series, chartWindow, onChartWindowChange, scopeLabel, sessionNames, onOpenSolveId, onOpenSolve }: TabProps & { onOpenSolve: (solve: Solve) => void }) {
  const [chart, setChart] = useState<"phases" | "recognition">("phases");
  return <>
    <StatsSection id="cfop-summary" title="Where the time goes" description={<>Medians of analysed normal solves{model.recentPerformance ? `; Δ is the latest ${model.recentPerformance.sampleSize} vs the ${model.recentPerformance.sampleSize} before` : ""} · {RECOGNITION_NOTE}</>}>
      <CfopSummary model={model} />
    </StatsSection>
    <StatisticsPhaseTable model={model} onOpenSolve={onOpenSolve} />
    <StatsSection id="cfop-trends" title="Trends" className="trend-section" description="Session-local rolling median of up to the latest 10 analysed solves · select a point to review its solve"
      actions={<><SegmentedControl label="CFOP trend" value={chart} onChange={setChart} options={[{ value: "phases", label: "Phases" }, { value: "recognition", label: "Recognition / execution" }]} /><ChartWindowSelect value={chartWindow} onChange={onChartWindowChange} /></>}>
      {chart === "phases"
        ? <CfopPhaseTrendChart points={series.phases} scopeLabel={scopeLabel} sessionNames={sessionNames} onOpenSolve={onOpenSolveId} emptyMessage={model.phaseTrend.length ? "No analysed solves in this chart window." : undefined} />
        : <RecognitionExecutionTrendChart points={series.recognition} scopeLabel={scopeLabel} sessionNames={sessionNames} onOpenSolve={onOpenSolveId} />}
    </StatsSection>
    <StatisticsCfopRecords key={`cfop:${model.event}:${model.sessionId ?? "all"}`} model={model} onOpenSolve={onOpenSolve} />
    <StatisticsPauses model={model} onOpenSolve={onOpenSolve} />
  </>;
}

export const STATISTICS_VIEWS = ["Overview", "Solves", "CFOP", "Cases"] as const;
export type StatisticsSubview = typeof STATISTICS_VIEWS[number];

export function StatisticsNavigation({ view, onSelect }: { view: StatisticsSubview; onSelect: (view: StatisticsSubview) => void }) {
  return <nav className="statistics-navigation" aria-label="Statistics views">{STATISTICS_VIEWS.map((item) => <button key={item} className="ghost" aria-pressed={view === item} onClick={() => onSelect(item)}>{item}</button>)}</nav>;
}

export function StatisticsView({ currentEvent, activeSessionId, onReplay, onTrainCase, onScopeChange }: {
  currentEvent: EventId; activeSessionId: string | null;
  onReplay: (solve: Solve) => void;
  onTrainCase: (family: LastLayerFamily, caseId: string) => void;
  onScopeChange: (solveIds: readonly string[]) => void;
}) {
  const controller = useController();
  const { slowSolveThreshold, slowSolveHandling } = useSettings();
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
    return deriveStatistics({ ...snapshot, solves: applySolveThreshold(snapshot.solves, { slowSolveThreshold, slowSolveHandling }) }, { event, sessionId: safeSessionId }, activeSessionId);
  }, [event, sessionId, snapshot, activeSessionId, slowSolveThreshold, slowSolveHandling]);

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
  const series = useMemo(() => model ? chartWindowSeries(model, chartWindow) : null, [model, chartWindow]);
  const solveById = useMemo(() => new Map(model?.scopeSolves.map((solve) => [solve.id, solve])), [model]);
  const sessionNames = useMemo(() => model?.sessionId === null ? new Map(model.eventSessions.map((session) => [session.id, session.name])) : undefined, [model]);
  const openSolveId = (id: string) => { const solve = solveById.get(id); if (solve) setDetailSolve(solve); };
  const tabProps = model && series ? { model, series, chartWindow, onChartWindowChange: setChartWindow, scopeLabel, sessionNames, onOpenSolveId: openSolveId } : null;

  return (
    <main className="statistics-page">
      <div className="statistics-toolbar">
        <div>
          <h1>Statistics</h1>
          <p>{model ? `${scopeLabel} · ${model.stats.count} counted · ${model.analysisCount} analysed${model.stats.solved ? ` (${Math.round(model.analysisCoverage * 100)}%)` : ""}` : "Historical solve analytics"}</p>
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
      {!loading && !error && model && tabProps ? (
        <>
          {model.ignoredSolveCount ? <div className="notice">{model.ignoredSolveCount} solve{model.ignoredSolveCount === 1 ? "" : "s"} could not be assigned to a known Session and {model.ignoredSolveCount === 1 ? "was" : "were"} omitted.</div> : null}
          {!model.eventSessions.length ? <div className="empty">No Sessions exist for this event.</div> : null}
          {view === "Overview" ? <StatisticsOverview {...tabProps} onSelectSession={setSessionId} /> : null}
          {view === "Solves" ? <StatisticsRecords key={`records:${model.event}:${model.sessionId ?? "all"}`} model={model} onOpenSolve={setDetailSolve} /> : null}
          {view === "CFOP" ? <StatisticsCfop {...tabProps} onOpenSolve={setDetailSolve} /> : null}
          {view === "Cases" ? <StatisticsAnalysisTables key={`analysis:${model.event}:${model.sessionId ?? "all"}`} model={model} onOpenSolve={setDetailSolve} onTrainCase={onTrainCase} /> : null}
        </>
      ) : null}
      {detailSolve && model?.scopeSolves.some((solve) => solve.id === detailSolve.id) ? <StatisticsSolveDetail solve={detailSolve} solves={model.scopeSolves} session={model.eventSessions.find((session) => session.id === detailSolve.sessionId)} onClose={() => setDetailSolve(null)} onReplay={onReplay} /> : null}
    </main>
  );
}
