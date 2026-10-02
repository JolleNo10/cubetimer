import { analysedSolveFacts, averageOf, bestAverage, countedSolves, sessionStats, type CfopPhaseMedian, type SessionStats } from "./stats";
import { eventInfo, type EventId } from "../cube/scramble";
import { effectiveMs, type Session, type Solve } from "./types";

export type StatisticsSnapshot = {
  sessions: Session[];
  solves: Solve[];
};

export type StatisticsScope = {
  event: EventId;
  sessionId: string | null;
};

export type ChartWindow = 50 | 100 | 250 | "all";

export type TrendPoint = {
  index: number;
  id: string;
  sessionId: string;
  createdAt: number;
  time: number | null;
  ao5: number | null | undefined;
  ao12: number | null | undefined;
  isPb: boolean;
};

export type DistributionBin = {
  startMs: number;
  endMs: number;
  count: number;
};

export type DistributionStats = {
  status: "ready" | "insufficient";
  bins: DistributionBin[];
  minMs?: number;
  maxMs?: number;
  medianMs?: number;
  dnfCount: number;
};

export type RecognitionExecutionStats = {
  sampleSize: number;
  meanMoves: number;
  aggregateTps: number;
  recognitionMs: number;
  executionMs: number;
  recognitionShare: number;
  executionShare: number;
};

export type PhaseTrendPoint = {
  index: number;
  solveId: string;
  sessionId: string;
  createdAt: number;
  crossMs: number;
  f2lMs: number;
  ollMs: number;
  pllMs: number;
};

export type SessionComparisonRow = {
  session: Session;
  stats: SessionStats;
  medianMs?: number;
  dnfRate: number;
  lastSolve: Solve | null;
  hasSolves: boolean;
  current: boolean;
};

export type StatisticsViewModel = {
  event: EventId;
  sessionId: string | null;
  eventSessions: Session[];
  scopeSolves: Solve[];
  ignoredSolveCount: number;
  stats: SessionStats;
  meanFinishedMs?: number;
  medianMs?: number;
  p25Ms?: number;
  p75Ms?: number;
  p90Ms?: number;
  dnfCount: number;
  dnfRate: number;
  analysisCount: number;
  analysisCoverage: number;
  bestAo50?: number;
  bestAo100?: number;
  trend: TrendPoint[];
  distribution: DistributionStats;
  recognitionExecution?: RecognitionExecutionStats;
  cfop?: CfopPhaseMedian[];
  phaseTrend: PhaseTrendPoint[];
  sessionComparison: SessionComparisonRow[];
};

function chronological(a: Solve, b: Solve): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Linear-interpolated percentile with stable behavior for small samples. */
export function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function finishedTimes(solves: readonly Solve[]): number[] {
  return solves
    .map(effectiveMs)
    .filter((time): time is number => time !== null);
}

function distribution(solves: readonly Solve[]): DistributionStats {
  const finished = finishedTimes(solves);
  const dnfCount = solves.length - finished.length;
  if (finished.length < 3) return { status: "insufficient", bins: [], dnfCount };

  const minMs = Math.min(...finished);
  const maxMs = Math.max(...finished);
  const binCount = minMs === maxMs
    ? 1
    : Math.min(16, Math.max(8, Math.ceil(Math.sqrt(finished.length) * 2)));
  const width = minMs === maxMs ? 1 : (maxMs - minMs) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    startMs: minMs + index * width,
    endMs: index === binCount - 1 ? maxMs : minMs + (index + 1) * width,
    count: 0,
  }));
  for (const time of finished) {
    const index = minMs === maxMs
      ? 0
      : Math.min(binCount - 1, Math.floor((time - minMs) / width));
    bins[index].count++;
  }
  return {
    status: "ready",
    bins,
    minMs,
    maxMs,
    medianMs: median(finished),
    dnfCount,
  };
}

function sessionMedian(solves: readonly Solve[]): number | undefined {
  return median(finishedTimes(countedSolves(solves)));
}

function sessionRows(
  eventSessions: Session[],
  solvesBySession: Map<string, Solve[]>,
  currentSessionId: string | null,
): SessionComparisonRow[] {
  const rows = eventSessions.map((session) => {
    const solves = [...(solvesBySession.get(session.id) ?? [])].sort(chronological);
    const counted = countedSolves(solves);
    const dnfs = counted.filter((solve) => effectiveMs(solve) === null).length;
    return {
      session,
      stats: sessionStats(solves),
      medianMs: sessionMedian(solves),
      dnfRate: counted.length ? dnfs / counted.length : 0,
      lastSolve: solves.at(-1) ?? null,
      hasSolves: solves.length > 0,
    };
  });
  return rows.sort((a, b) => {
    if (a.hasSolves !== b.hasSolves) return a.hasSolves ? -1 : 1;
    const aLast = a.lastSolve?.createdAt ?? -Infinity;
    const bLast = b.lastSolve?.createdAt ?? -Infinity;
    return bLast - aLast
      || b.session.createdAt - a.session.createdAt
      || a.session.name.localeCompare(b.session.name)
      || a.session.id.localeCompare(b.session.id);
  }).map((row) => ({ ...row, current: row.session.id === currentSessionId }));
}

function phaseTrend(solves: readonly Solve[]): PhaseTrendPoint[] {
  const facts = solves
    .map(analysedSolveFacts)
    .filter((facts): facts is NonNullable<typeof facts> => facts !== null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return facts.map((fact, index) => {
    const recent = facts.slice(Math.max(0, index - 9), index + 1);
    return {
      index: index + 1,
      solveId: fact.id,
      sessionId: fact.sessionId,
      createdAt: fact.createdAt,
      crossMs: median(recent.map((item) => item.phases.crossMs)) ?? 0,
      f2lMs: median(recent.map((item) => item.phases.f2lMs)) ?? 0,
      ollMs: median(recent.map((item) => item.phases.ollMs)) ?? 0,
      pllMs: median(recent.map((item) => item.phases.pllMs)) ?? 0,
    };
  });
}

function makeTrend(solves: readonly Solve[]): TrendPoint[] {
  let best: number | undefined;
  return solves.map((solve, index) => {
    const time = effectiveMs(solve);
    const isPb = time !== null && (best === undefined || time < best);
    if (isPb) best = time;
    const prefix = solves.slice(0, index + 1);
    return {
      index: index + 1,
      id: solve.id,
      sessionId: solve.sessionId,
      createdAt: solve.createdAt,
      time,
      ao5: averageOf(prefix, 5),
      ao12: averageOf(prefix, 12),
      isPb,
    };
  });
}

function recognitionExecution(solves: readonly Solve[]): RecognitionExecutionStats | undefined {
  const facts = solves
    .map(analysedSolveFacts)
    .filter((facts): facts is NonNullable<typeof facts> => facts !== null);
  if (facts.length === 0) return undefined;
  const totalMoves = facts.reduce((sum, fact) => sum + fact.sliceTurns, 0);
  const solvingMs = facts.reduce((sum, fact) => sum + fact.solvingMs, 0);
  const recognitionMs = facts.reduce((sum, fact) => sum + fact.recognitionMs, 0);
  const executionMs = facts.reduce((sum, fact) => sum + fact.executionMs, 0);
  return {
    sampleSize: facts.length,
    meanMoves: totalMoves / facts.length,
    aggregateTps: totalMoves / solvingMs * 1000,
    recognitionMs,
    executionMs,
    recognitionShare: recognitionMs / solvingMs,
    executionShare: executionMs / solvingMs,
  };
}

export function availableStatisticsEvents(snapshot: StatisticsSnapshot): EventId[] {
  const ids = new Set(snapshot.sessions.map((session) => session.event));
  return [...ids].sort((a, b) => eventInfo(a).name.localeCompare(eventInfo(b).name));
}

/** Derive the complete, event-safe dashboard model from a Controller snapshot. */
export function deriveStatistics(
  snapshot: StatisticsSnapshot,
  scope: StatisticsScope,
): StatisticsViewModel {
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const eventSessions = snapshot.sessions.filter((session) => session.event === scope.event);
  const known = snapshot.solves.filter((solve) => sessionsById.has(solve.sessionId));
  const ignoredSolveCount = snapshot.solves.length - known.length;
  const eventSolves = known.filter((solve) => sessionsById.get(solve.sessionId)!.event === scope.event);
  const scopeSolves = [...(
    scope.sessionId === null
      ? eventSolves
      : eventSolves.filter((solve) => solve.sessionId === scope.sessionId)
  )].sort(chronological);
  const counted = countedSolves(scopeSolves);
  const finished = finishedTimes(counted);
  const dnfCount = counted.length - finished.length;
  const stats = sessionStats(scopeSolves);
  const facts = scopeSolves.map(analysedSolveFacts).filter((facts): facts is NonNullable<typeof facts> => facts !== null);
  const bySession = new Map<string, Solve[]>();
  for (const solve of eventSolves) {
    const list = bySession.get(solve.sessionId) ?? [];
    list.push(solve);
    bySession.set(solve.sessionId, list);
  }
  return {
    event: scope.event,
    sessionId: scope.sessionId,
    eventSessions,
    scopeSolves,
    ignoredSolveCount,
    stats,
    meanFinishedMs: finished.length ? finished.reduce((sum, time) => sum + time, 0) / finished.length : undefined,
    medianMs: percentile(finished, 0.5),
    p25Ms: percentile(finished, 0.25),
    p75Ms: percentile(finished, 0.75),
    p90Ms: percentile(finished, 0.9),
    dnfCount,
    dnfRate: counted.length ? dnfCount / counted.length : 0,
    analysisCount: facts.length,
    analysisCoverage: finished.length ? facts.length / finished.length : 0,
    bestAo50: bestAverage(counted, 50),
    bestAo100: bestAverage(counted, 100),
    trend: makeTrend(counted),
    distribution: distribution(counted),
    recognitionExecution: recognitionExecution(scopeSolves),
    cfop: stats.cfop,
    phaseTrend: phaseTrend(scopeSolves),
    sessionComparison: sessionRows(eventSessions, bySession, scope.sessionId),
  };
}

export function sliceChartWindow<T>(items: readonly T[], window: ChartWindow): T[] {
  return window === "all" ? [...items] : items.slice(-window);
}
