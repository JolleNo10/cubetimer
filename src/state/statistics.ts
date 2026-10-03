import { analysedSolveFacts, averageWindow, countedSolves, sessionStats, type AverageWindow, type AnalysedSolveFacts, type CfopPhaseMedian, type SessionStats } from "./stats";
import type { SolveStep } from "../cube/analysis";
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
  meanRecognitionMs: number;
  recognitionMs: number;
  executionMs: number;
  solvingMs: number;
  unclassifiedMs: number;
  recognitionShare: number;
  executionShare: number;
  unclassifiedShare: number;
  medianRecognitionMs: number;
  medianExecutionMs: number;
  medianF2lRecognitionMs: number;
  medianOllRecognitionMs?: number;
  medianPllRecognitionMs?: number;
  medianRecognitionShare: number;
  medianExecutionShare: number;
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
  p10Ms?: number;
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
  records: Record<RankingMetric, RankingRow[]>;
  averageProgression: AverageProgressionPoint[];
  pbHistory: Record<PbMetric, RankingRow[]>;
  f2lPositions: PerformanceSummary[];
  ollCases: CasePerformance[];
  pllCases: CasePerformance[];
  ollSkips: number;
  pllSkips: number;
  recognitionTrend: RecognitionTrendPoint[];
  pauses?: PauseStats;
  consistency: ConsistencyStats;
  bestSplits: BestSplits;
  solveRows: StatisticsSolveRow[];
  latestAverages: Partial<Record<AverageMetric, { solveId: string; sessionId: string; window: AverageWindow }>>;
  f2lSlots: PerformanceSummary[];
  f2lUnassignedCount: number;
};

export const RANKING_METRICS = [
  { id: "single", label: "Single", group: "Solve", unit: "time", direction: "asc" },
  { id: "tps", label: "TPS (whole solve)", group: "Solve", unit: "tps", direction: "desc" },
  { id: "moves", label: "Moves / STM", group: "Solve", unit: "moves", direction: "asc" },
  { id: "recognition", label: "Measured recognition", group: "Solve", unit: "time", direction: "asc" },
  { id: "execution", label: "Measured execution", group: "Solve", unit: "time", direction: "asc" },
  ...([5, 12, 50, 100] as const).map((size) => ({ id: `ao${size}` as const, label: `Ao${size}`, group: "Averages", unit: "time" as const, direction: "asc" as const })),
  ...(["cross", "xcross", "f2l", "oll", "pll", "last-layer"] as const).map((id) => ({ id, label: ({ cross: "Cross", xcross: "XCross", f2l: "F2L", oll: "OLL", pll: "PLL", "last-layer": "Last Layer" })[id], group: "Phases", unit: "time" as const, direction: "asc" as const })),
  { id: "cross-moves", label: "Cross moves", group: "Efficiency", unit: "moves", direction: "asc" },
  { id: "f2l-moves", label: "F2L moves", group: "Efficiency", unit: "moves", direction: "asc" },
  { id: "f2l-tps", label: "F2L execution TPS", group: "Efficiency", unit: "tps", direction: "desc" },
  { id: "oll-tps", label: "OLL execution TPS", group: "Efficiency", unit: "tps", direction: "desc" },
  { id: "pll-tps", label: "PLL execution TPS", group: "Efficiency", unit: "tps", direction: "desc" },
] as const;
export type RankingMetric = typeof RANKING_METRICS[number]["id"];
export type SortDirection = "asc" | "desc";
export type PbMetric = "single" | "ao5" | "ao12" | "ao50" | "ao100";
export type RankingRow = {
  id: string; value: number; createdAt: number; sessionId: string;
  moves?: number; tps?: number; totalTime: number | null; context: string;
} & ({ kind: "solve"; solveId: string } | { kind: "average"; endSolveId: string; window: AverageWindow; solveIds: string[]; startAt: number });
export type AverageProgressionPoint = {
  index: number; solveId: string; createdAt: number;
  ao5?: number | null; ao12?: number | null; ao50?: number | null; ao100?: number | null;
};
export type RecognitionTrendPoint = { index: number; solveId: string; recognitionMs: number; executionMs: number; unclassifiedMs: number };
export type PerformanceSample = {
  solveId: string; timeMs: number; recognitionMs: number; executionMs: number; moves: number; tps?: number;
};
export type PerformanceSummary = {
  label: string; count: number; skipCount: number; solveIds: string[]; samples: PerformanceSample[];
  bestMs?: number; medianMs?: number; recognitionMs?: number; executionMs?: number; moves?: number; tps?: number;
};
export type CasePerformance = PerformanceSummary & { caseId: string };
export type CaseSort = "case" | "count" | "median" | "recognition" | "execution" | "tps";
export type PauseStats = {
  sampleSize: number; pauseCount: number; meanCount: number; meanDurationMs?: number; meanTotalMs: number;
  pauseFreeCount: number; pauseFreeShare: number;
  longest?: { solveId: string; durationMs: number };
  phases: { name: "Cross" | "F2L" | "OLL" | "PLL"; totalMs: number; share: number }[];
};
export type ConsistencyStats = { pbMs?: number; medianMs?: number; gapMs?: number; gapShare?: number; p10Ms?: number; p25Ms?: number; p75Ms?: number; p90Ms?: number };
export type BestSplits = { sources: { phase: string; record?: RankingRow }[]; totalMs?: number; pbMs?: number; gapMs?: number };

export const RECOGNITION_NOTE = "Cross planning before the first turn is not measured. Recognition is inferred from move timing.";

export const AVERAGE_SIZES = [5, 12, 50, 100] as const;
export type AverageMetric = `ao${typeof AVERAGE_SIZES[number]}`;
export type RollingAverages = Partial<Record<AverageMetric, AverageWindow>>;
export type StatisticsSolveRow = {
  solve: Solve; time: number | null; session: string; date: number; averages: RollingAverages;
  tps?: number; stm?: number; cross?: number; f2l?: number; oll?: number; pll?: number; xCrossCount?: number;
};
export type SolveSortColumn = "time" | AverageMetric | "tps" | "stm" | "cross" | "f2l" | "oll" | "pll" | "session" | "date";

/** Input is already counted and chronological; each window belongs to its ending solve's Session. */
export function sessionRollingAverages(solves: readonly Solve[]): Map<string, RollingAverages> {
  const histories = new Map<string, Solve[]>();
  const result = new Map<string, RollingAverages>();
  for (const solve of solves) {
    const history = histories.get(solve.sessionId) ?? [];
    history.push(solve);
    if (history.length > 100) history.shift();
    histories.set(solve.sessionId, history);
    const windows: RollingAverages = {};
    for (const size of AVERAGE_SIZES) {
      const window = averageWindow(history, size);
      if (window) windows[`ao${size}`] = window;
    }
    result.set(solve.id, windows);
  }
  return result;
}

/** Missing metrics stay last in either direction; null is a real DNF result. */
export function sortSolveRows(rows: readonly StatisticsSolveRow[], column: SolveSortColumn, direction: SortDirection): StatisticsSolveRow[] {
  const metric = (row: StatisticsSolveRow): number | string | null | undefined =>
    column.startsWith("ao") ? row.averages[column as AverageMetric]?.value : row[column as Exclude<SolveSortColumn, AverageMetric>];
  return [...rows].sort((a, b) => {
    const av = metric(a), bv = metric(b);
    if (av === undefined || bv === undefined) return av === bv ? chronological(a.solve, b.solve) : av === undefined ? 1 : -1;
    const order = av === null ? bv === null ? 0 : 1 : bv === null ? -1
      : typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : (av as number) - (bv as number);
    return order * (direction === "asc" ? 1 : -1) || chronological(a.solve, b.solve);
  });
}

function unclassifiedTime(fact: AnalysedSolveFacts): number {
  // Validation rejects material negative remainders; only floating-point noise is clamped.
  return Math.max(0, fact.solvingMs - fact.recognitionMs - fact.executionMs);
}

export function sortRankingRows(rows: readonly RankingRow[], direction: SortDirection): RankingRow[] {
  return [...rows].sort((a, b) => (a.value - b.value) * (direction === "asc" ? 1 : -1) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function skipped(step: SolveStep): boolean {
  return step.skipped || step.case === "Solved" || (step.fromMove === step.toMove && step.sliceTurns === 0);
}
function executionTps(moves: number, ms: number): number | undefined { return ms > 0 ? moves / ms * 1000 : undefined; }

function recordModels(solves: readonly Solve[], facts: readonly AnalysedSolveFacts[], rolling: Map<string, RollingAverages>) {
  const solvesById = new Map(solves.map((solve) => [solve.id, solve]));
  const records = Object.fromEntries(RANKING_METRICS.map((metric) => [metric.id, []])) as unknown as Record<RankingMetric, RankingRow[]>;
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const progression: AverageProgressionPoint[] = [];
  solves.forEach((solve, index) => {
    const fact = factsById.get(solve.id);
    const base = { id: solve.id, kind: "solve" as const, solveId: solve.id, createdAt: solve.createdAt, sessionId: solve.sessionId, totalTime: effectiveMs(solve), moves: fact?.sliceTurns, tps: fact?.tps, context: "" };
    const add = (metric: RankingMetric, value: number | null | undefined, context = "", moves = base.moves, tps = base.tps) => {
      if (typeof value === "number" && Number.isFinite(value)) records[metric].push({ ...base, value, context, moves, tps });
    };
    add("single", base.totalTime);
    if (fact) {
      const [cross, ...rest] = fact.steps;
      const f2l = rest.slice(0, 4);
      const [oll, pll] = fact.steps.slice(5);
      const f2lMoves = f2l.reduce((sum, step) => sum + step.sliceTurns, 0);
      const f2lExecution = f2l.reduce((sum, step) => sum + step.executionMs, 0);
      const pairContext = fact.xCrossCount ? `${fact.xCrossCount} pair${fact.xCrossCount === 1 ? "" : "s"} at Cross` : "";
      add("tps", fact.tps); add("moves", fact.sliceTurns);
      add("recognition", fact.recognitionMs); add("execution", fact.executionMs);
      if (!skipped(cross)) {
        add("cross", cross.timeMs, pairContext, cross.sliceTurns, executionTps(cross.sliceTurns, cross.executionMs));
        add("cross-moves", cross.sliceTurns, pairContext, cross.sliceTurns, executionTps(cross.sliceTurns, cross.executionMs));
        if (fact.xCrossCount) add("xcross", cross.timeMs, pairContext, cross.sliceTurns, executionTps(cross.sliceTurns, cross.executionMs));
      }
      add("f2l", fact.phases.f2lMs, pairContext, f2lMoves, executionTps(f2lMoves, f2lExecution));
      add("f2l-moves", f2lMoves, pairContext, f2lMoves, executionTps(f2lMoves, f2lExecution));
      add("f2l-tps", executionTps(f2lMoves, f2lExecution), pairContext, f2lMoves, executionTps(f2lMoves, f2lExecution));
      for (const [family, step] of [["oll", oll], ["pll", pll]] as const) {
        if (!skipped(step)) {
          add(family, step.timeMs, step.case ?? "", step.sliceTurns, executionTps(step.sliceTurns, step.executionMs));
          add(`${family}-tps`, executionTps(step.sliceTurns, step.executionMs), step.case ?? "", step.sliceTurns, executionTps(step.sliceTurns, step.executionMs));
        }
      }
      add("last-layer", oll.timeMs + pll.timeMs, [skipped(oll) ? "OLL skip" : "", skipped(pll) ? "PLL skip" : ""].filter(Boolean).join(" · "), oll.sliceTurns + pll.sliceTurns, executionTps(oll.sliceTurns + pll.sliceTurns, oll.executionMs + pll.executionMs));
    }
    const point: AverageProgressionPoint = { index: index + 1, solveId: solve.id, createdAt: solve.createdAt };
    for (const size of AVERAGE_SIZES) {
      const metric = `ao${size}` as const;
      const window = rolling.get(solve.id)?.[metric];
      if (!window) continue;
      point[metric] = window.value;
      if (typeof window.value === "number" && Number.isFinite(window.value)) records[metric].push({
        id: `${metric}:${solve.id}`, kind: "average", value: window.value, createdAt: solve.createdAt,
        sessionId: solve.sessionId, totalTime: null, context: `${size} solves`, endSolveId: solve.id,
        solveIds: window.entries.map((entry) => entry.solveId), startAt: solvesById.get(window.entries[0].solveId)!.createdAt, window,
      });
    }
    if (rolling.get(solve.id)?.ao5) progression.push(point);
  });
  const pbHistory = {} as Record<PbMetric, RankingRow[]>;
  for (const metric of ["single", "ao5", "ao12", "ao50", "ao100"] as const) {
    let best = Infinity;
    pbHistory[metric] = records[metric].filter((row) => { if (row.value >= best) return false; best = row.value; return true; });
  }
  for (const metric of RANKING_METRICS) records[metric.id] = sortRankingRows(records[metric.id], metric.direction);
  const sources = (["cross", "f2l", "oll", "pll"] as const).map((metric) => ({
    phase: metric === "cross" ? "Cross" : metric.toUpperCase(),
    record: metric === "f2l" ? records.f2l.find((row) => row.kind === "solve" && factsById.get(row.solveId)?.xCrossCount === 0) : records[metric][0],
  }));
  const totalMs = sources.every((source) => source.record) ? sources.reduce((sum, source) => sum + source.record!.value, 0) : undefined;
  const pbMs = records.single[0]?.value;
  const bestSplits: BestSplits = { sources, totalMs, pbMs, gapMs: totalMs === undefined || pbMs === undefined ? undefined : pbMs - totalMs };
  return { records, averageProgression: progression, pbHistory, bestSplits };
}

function performance(label: string, samples: { fact: AnalysedSolveFacts; step: SolveStep }[]): PerformanceSummary {
  const performed = samples.filter(({ step }) => !skipped(step));
  const sum = (key: "sliceTurns" | "executionMs") => performed.reduce((total, { step }) => total + step[key], 0);
  return {
    label, count: performed.length, skipCount: samples.length - performed.length,
    samples: performed.map(({ fact, step }) => ({ solveId: fact.id, timeMs: step.timeMs, recognitionMs: step.recognitionMs, executionMs: step.executionMs, moves: step.sliceTurns, tps: executionTps(step.sliceTurns, step.executionMs) })),
    solveIds: performed.map(({ fact }) => fact.id), bestMs: performed.length ? Math.min(...performed.map(({ step }) => step.timeMs)) : undefined,
    medianMs: median(performed.map(({ step }) => step.timeMs)), recognitionMs: median(performed.map(({ step }) => step.recognitionMs)),
    executionMs: median(performed.map(({ step }) => step.executionMs)), moves: median(performed.map(({ step }) => step.sliceTurns)),
    tps: executionTps(sum("sliceTurns"), sum("executionMs")),
  };
}

function casePerformance(facts: readonly AnalysedSolveFacts[], index: 5 | 6): CasePerformance[] {
  const groups = new Map<string, { fact: AnalysedSolveFacts; step: SolveStep }[]>();
  for (const fact of facts) {
    const step = fact.steps[index];
    if (!step.case || skipped(step)) continue;
    const samples = groups.get(step.case) ?? [];
    samples.push({ fact, step }); groups.set(step.case, samples);
  }
  return sortCasePerformance([...groups].map(([caseId, samples]) => ({ ...performance(caseId, samples), caseId })), "case", "asc");
}

export function sortCasePerformance(rows: readonly CasePerformance[], sort: CaseSort, direction: SortDirection): CasePerformance[] {
  const key = { count: "count", median: "medianMs", recognition: "recognitionMs", execution: "executionMs", tps: "tps" } as const;
  return [...rows].sort((a, b) => {
    const order = sort === "case" ? a.caseId.localeCompare(b.caseId, undefined, { numeric: true })
      : a[key[sort]] === undefined ? b[key[sort]] === undefined ? 0 : 1
      : b[key[sort]] === undefined ? -1 : (a[key[sort]]! - b[key[sort]]!) * (direction === "asc" ? 1 : -1);
    return (sort === "case" ? order * (direction === "asc" ? 1 : -1) : order) || a.caseId.localeCompare(b.caseId, undefined, { numeric: true });
  });
}

function pauseStatistics(facts: readonly AnalysedSolveFacts[]): PauseStats | undefined {
  if (!facts.length) return undefined;
  const phases: PauseStats["phases"] = ["Cross", "F2L", "OLL", "PLL"].map((name) => ({ name: name as PauseStats["phases"][number]["name"], totalMs: 0, share: 0 }));
  let pauseCount = 0, totalMs = 0;
  let longest: PauseStats["longest"];
  for (const fact of facts) for (const pause of fact.pauses) {
    pauseCount++; totalMs += pause.durationMs;
    if (!longest || pause.durationMs > longest.durationMs) longest = { solveId: fact.id, durationMs: pause.durationMs };
    const nextMove = pause.afterMove + 1;
    const step = fact.steps.findIndex((step) => step.fromMove <= nextMove && nextMove < step.toMove);
    const phase = step === 0 ? 0 : step < 5 ? 1 : step === 5 ? 2 : 3;
    phases[phase].totalMs += pause.durationMs;
  }
  for (const phase of phases) phase.share = totalMs > 0 ? phase.totalMs / totalMs : 0;
  const pauseFreeCount = facts.filter((fact) => fact.pauses.length === 0).length;
  return { sampleSize: facts.length, pauseCount, meanCount: pauseCount / facts.length, meanDurationMs: pauseCount ? totalMs / pauseCount : undefined, meanTotalMs: totalMs / facts.length, pauseFreeCount, pauseFreeShare: pauseFreeCount / facts.length, longest, phases };
}

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
  activeSessionId: string | null,
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
  }).map((row) => ({ ...row, current: row.session.id === activeSessionId }));
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

function makeTrend(solves: readonly Solve[], rolling: Map<string, RollingAverages>): TrendPoint[] {
  let best: number | undefined;
  return solves.map((solve, index) => {
    const time = effectiveMs(solve);
    const isPb = time !== null && (best === undefined || time < best);
    if (isPb) best = time;
    return {
      index: index + 1,
      id: solve.id,
      sessionId: solve.sessionId,
      createdAt: solve.createdAt,
      time,
      ao5: rolling.get(solve.id)?.ao5?.value,
      ao12: rolling.get(solve.id)?.ao12?.value,
      isPb,
    };
  });
}

function recognitionExecution(facts: readonly AnalysedSolveFacts[]): RecognitionExecutionStats | undefined {
  if (facts.length === 0) return undefined;
  const totalMoves = facts.reduce((sum, fact) => sum + fact.sliceTurns, 0);
  const solvingMs = facts.reduce((sum, fact) => sum + fact.solvingMs, 0);
  const recognitionMs = facts.reduce((sum, fact) => sum + fact.recognitionMs, 0);
  const executionMs = facts.reduce((sum, fact) => sum + fact.executionMs, 0);
  const unclassifiedMs = facts.reduce((sum, fact) => sum + unclassifiedTime(fact), 0);
  return {
    sampleSize: facts.length,
    meanMoves: totalMoves / facts.length,
    aggregateTps: totalMoves / solvingMs * 1000,
    meanRecognitionMs: recognitionMs / facts.length,
    recognitionMs,
    executionMs,
    solvingMs,
    unclassifiedMs,
    recognitionShare: recognitionMs / solvingMs,
    executionShare: executionMs / solvingMs,
    unclassifiedShare: unclassifiedMs / solvingMs,
    medianRecognitionMs: median(facts.map((fact) => fact.recognitionMs))!,
    medianExecutionMs: median(facts.map((fact) => fact.executionMs))!,
    medianF2lRecognitionMs: median(facts.map((fact) => fact.steps.slice(1, 5).reduce((sum, step) => sum + step.recognitionMs, 0)))!,
    medianOllRecognitionMs: median(facts.filter((fact) => !skipped(fact.steps[5])).map((fact) => fact.steps[5].recognitionMs)),
    medianPllRecognitionMs: median(facts.filter((fact) => !skipped(fact.steps[6])).map((fact) => fact.steps[6].recognitionMs)),
    medianRecognitionShare: median(facts.map((fact) => fact.recognitionShare))!,
    medianExecutionShare: median(facts.map((fact) => fact.executionMs / fact.solvingMs))!,
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
  activeSessionId: string | null,
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
  const facts = scopeSolves.map(analysedSolveFacts).filter((facts): facts is NonNullable<typeof facts> => facts !== null);
  const rolling = sessionRollingAverages(counted);
  const recordModel = recordModels(counted, facts, rolling);
  const latestAverages: StatisticsViewModel["latestAverages"] = {};
  for (const solve of counted) for (const size of AVERAGE_SIZES) {
    const metric = `ao${size}` as const;
    const window = rolling.get(solve.id)?.[metric];
    if (window) latestAverages[metric] = { solveId: solve.id, sessionId: solve.sessionId, window };
  }
  // Independent facts can be aggregated, but never run sessionStats on merged Sessions.
  const stats: SessionStats = scope.sessionId !== null ? sessionStats(scopeSolves) : {
    ...sessionStats([]), count: counted.length, solved: finished.length,
    best: finished.length ? Math.min(...finished) : undefined,
    worst: finished.length ? Math.max(...finished) : undefined,
    mean: counted.length ? dnfCount ? null : finished.reduce((sum, time) => sum + time, 0) / counted.length : undefined,
    solving: recognitionExecution(facts),
    cfop: facts.length ? (["crossMs", "f2lMs", "ollMs", "pllMs"] as const).map((key, index) => ({ name: (["Cross", "F2L", "OLL", "PLL"] as const)[index], timeMs: median(facts.map((fact) => fact.phases[key]))! })) : undefined,
  };
  stats.ao5 = scope.sessionId === null ? latestAverages.ao5?.window.value : rolling.get(counted.at(-1)?.id ?? "")?.ao5?.value;
  stats.ao12 = scope.sessionId === null ? latestAverages.ao12?.window.value : rolling.get(counted.at(-1)?.id ?? "")?.ao12?.value;
  stats.bestAo5 = recordModel.records.ao5[0]?.value;
  stats.bestAo12 = recordModel.records.ao12[0]?.value;
  for (const size of [50, 100] as const) {
    const window = latestAverages[`ao${size}`]?.window;
    if (window || scope.sessionId === null) stats[`ao${size}`] = { size, status: window ? "actual" : "unavailable", count: window ? size : 0, value: window?.value };
  }
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const solveRows = counted.map((solve): StatisticsSolveRow => {
    const fact = factsById.get(solve.id);
    return {
      solve, time: effectiveMs(solve), session: sessionsById.get(solve.sessionId)!.name, date: solve.createdAt,
      averages: rolling.get(solve.id)!, tps: fact?.tps, stm: fact?.sliceTurns, cross: fact?.phases.crossMs,
      f2l: fact?.phases.f2lMs, oll: fact?.phases.ollMs, pll: fact?.phases.pllMs, xCrossCount: fact?.xCrossCount,
    };
  });
  const pairs = facts.flatMap((fact) => fact.steps.slice(1, 5).map((step) => ({ fact, step })));
  const slots = ["FR", "FL", "BR", "BL"] as const;
  const medianMs = percentile(finished, 0.5);
  const consistency: ConsistencyStats = {
    pbMs: stats.best, medianMs,
    gapMs: stats.best === undefined || medianMs === undefined ? undefined : medianMs - stats.best,
    gapShare: stats.best === undefined || !medianMs ? undefined : (medianMs - stats.best) / medianMs,
    p10Ms: percentile(finished, 0.1), p25Ms: percentile(finished, 0.25), p75Ms: percentile(finished, 0.75), p90Ms: percentile(finished, 0.9),
  };
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
    medianMs,
    p10Ms: consistency.p10Ms,
    p25Ms: percentile(finished, 0.25),
    p75Ms: percentile(finished, 0.75),
    p90Ms: percentile(finished, 0.9),
    dnfCount,
    dnfRate: counted.length ? dnfCount / counted.length : 0,
    analysisCount: facts.length,
    analysisCoverage: finished.length ? facts.length / finished.length : 0,
    bestAo50: recordModel.records.ao50[0]?.value,
    bestAo100: recordModel.records.ao100[0]?.value,
    trend: makeTrend(counted, rolling),
    distribution: distribution(counted),
    recognitionExecution: recognitionExecution(facts),
    cfop: stats.cfop,
    phaseTrend: phaseTrend(scopeSolves),
    sessionComparison: sessionRows(eventSessions, bySession, activeSessionId),
    ...recordModel,
    solveRows, latestAverages,
    f2lSlots: slots.map((slot) => performance(slot, pairs.filter(({ step }) => step.slot === slot))),
    f2lUnassignedCount: pairs.filter(({ step }) => !slots.some((slot) => step.slot === slot)).length,
    f2lPositions: ["1st pair", "2nd pair", "3rd pair", "4th pair"].map((label, index) => performance(label, facts.map((fact) => ({ fact, step: fact.steps[index + 1] })))),
    ollCases: casePerformance(facts, 5), pllCases: casePerformance(facts, 6),
    ollSkips: facts.filter((fact) => skipped(fact.steps[5])).length,
    pllSkips: facts.filter((fact) => skipped(fact.steps[6])).length,
    recognitionTrend: facts.map((fact, index) => {
      const recent = facts.slice(Math.max(0, index - 9), index + 1);
      return { index: index + 1, solveId: fact.id, recognitionMs: median(recent.map((fact) => fact.recognitionMs))!, executionMs: median(recent.map((fact) => fact.executionMs))!, unclassifiedMs: median(recent.map(unclassifiedTime))! };
    }),
    pauses: pauseStatistics(facts), consistency,
  };
}

export function sliceChartWindow<T>(items: readonly T[], window: ChartWindow): T[] {
  return window === "all" ? [...items] : items.slice(-window);
}

/** Match CFOP presentation to the same counted-solve window as the singles chart. */
export function filterPhaseChartWindow<T extends { solveId: string }>(
  points: readonly T[],
  visibleTrend: readonly TrendPoint[],
  window: ChartWindow,
): T[] {
  if (window === "all") return [...points];
  const visibleIds = new Set(visibleTrend.map((point) => point.id));
  return points.filter((point) => visibleIds.has(point.solveId));
}
