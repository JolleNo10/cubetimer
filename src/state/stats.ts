import { STEP_NAMES, PAUSE_THRESHOLD_MS, type StepName, type SolveStep, type SolveAnalysis } from "../cube/analysis";
import { effectiveMs, type Solve } from "./types";

const MIN_COMPARISON_SOLVES = 3;
const MAX_COMPARISON_SOLVES = 20;
const MIN_PROJECTION_SOLVES = 10;
const MAX_PROJECTION_SOLVES = 20;

export type StepComparison = {
  name: StepName;
  currentMs: number;
  baselineMs: number;
  deltaMs: number;
  skipped: boolean;
};

export type SolveComparison = {
  sampleSize: number;
  steps: StepComparison[];
};

export type AnalysedSolveFacts = {
  id: string;
  sessionId: string;
  createdAt: number;
  rotation: SolveAnalysis["rotation"];
  sliceTurns: number;
  solvingMs: number;
  recognitionMs: number;
  executionMs: number;
  tps: number;
  recognitionShare: number;
  steps: readonly SolveStep[];
  pauses: SolveAnalysis["pauses"];
  xCrossCount: number;
  phases: {
    crossMs: number;
    f2lMs: number;
    ollMs: number;
    pllMs: number;
  };
};

/** Keep Result comparison mode in sync with the Result's slow-solve label. */
export function isSlowSolve(solve: Pick<Solve, "slowSolve" | "practice" | "replay">): boolean {
  return solve.replay !== true && (
    solve.slowSolve === true
      || (solve.slowSolve === undefined && solve.practice === true)
  );
}

function compatibleAnalysis(
  current: NonNullable<Solve["analysis"]>,
  candidate: NonNullable<Solve["analysis"]>,
): boolean {
  return current.method === "CFOP"
    && candidate.method === current.method
    && Array.isArray(current.steps) && Array.isArray(candidate.steps)
    && current.steps.length === STEP_NAMES.length
    && candidate.steps.length === current.steps.length
    && current.steps.every((step, index) =>
      step && candidate.steps[index] && step.name === STEP_NAMES[index] && candidate.steps[index].name === step.name);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The single eligibility rule shared by ordinary statistics and their richer views. */
export function isCountedSolve(
  solve: Pick<Solve, "practice" | "replay" | "slowSolve">,
): boolean {
  return solve.practice !== true && solve.replay !== true && solve.slowSolve !== true;
}

/** Compare one completed solve with the latest comparable solves in its session. */
export function compareSolveToHistory(
  currentSolve: Solve,
  solves: readonly Solve[],
): SolveComparison | null {
  const currentAnalysis = currentSolve.analysis;
  if (!currentAnalysis) return null;

  const currentIndex = solves.findIndex((solve) => solve.id === currentSolve.id);
  if (currentIndex < 0) return null;

  const comparisonSolves = solves
    .slice(0, currentIndex)
    .filter((solve) => {
      const analysis = solve.analysis;
      return solve.sessionId === currentSolve.sessionId
        && solve.replay !== true
        && isSlowSolve(solve) === isSlowSolve(currentSolve)
        && analysis !== null
        && analysis !== undefined
        && compatibleAnalysis(currentAnalysis, analysis);
    })
    .slice(-MAX_COMPARISON_SOLVES);

  if (comparisonSolves.length < MIN_COMPARISON_SOLVES) return null;

  return {
    sampleSize: comparisonSolves.length,
    steps: currentAnalysis.steps.map((step, index) => {
      const baselineMs = median(
        comparisonSolves.map((solve) => solve.analysis!.steps[index].timeMs),
      );
      return {
        name: step.name,
        currentMs: step.timeMs,
        baselineMs,
        deltaMs: step.timeMs - baselineMs,
        skipped: step.skipped === true,
      };
    }),
  };
}

/**
 * The solves a session's figures are built from.
 *
 * Slow solves are deliberately untimed practice, so counting them would drag every
 * average towards meaninglessness.
 */
export function countedSolves(solves: readonly Solve[]): Solve[] {
  return solves.filter(isCountedSolve);
}

/**
 * WCA average of `n`: drop the fastest and slowest result, mean the rest.
 * A single DNF counts as the slowest result and is dropped; two or more make the
 * average a DNF. Returns `null` for DNF and `undefined` when there are too few solves.
 */
export function averageOf(solves: Solve[], n: number): number | null | undefined {
  return averageWindow(solves, n)?.value;
}

export type AverageWindow = {
  size: number;
  value: number | null;
  entries: { solveId: string; time: number | null; trim: "best" | "worst" | "kept"; causesDnf: boolean }[];
};

/** Exact chronological membership and trims, using the same rule as every average. */
export function averageWindow(solves: readonly Solve[], n: number): AverageWindow | undefined {
  if (solves.length < n) return undefined;
  const members = solves.slice(-n);
  const summary = averageSummary(members.map(effectiveMs));
  return { size: n, value: summary.value, entries: summary.entries.map((entry, index) => ({ ...entry, solveId: members[index].id })) };
}

/** The existing trimming/DNF rule, shared by achieved and projected averages. */
function averageTimes(times: readonly (number | null)[]): number | null {
  return averageSummary(times).value;
}

function averageSummary(times: readonly (number | null)[]) {
  const sorted = times.map((time, index) => ({ time, index }))
    .sort((a, b) => a.time === null ? b.time === null ? a.index - b.index : 1
      : b.time === null ? -1 : a.time - b.time || a.index - b.index);
  const best = sorted[0]?.index;
  const worst = sorted.at(-1)?.index;
  const kept = sorted.slice(1, -1);
  const value = times.filter((time) => time === null).length > 1 || !kept.length
    ? null : kept.reduce((sum, item) => sum + (item.time ?? 0), 0) / kept.length;
  const entries = times.map((time, index) => ({
    time,
    trim: index === best ? "best" as const : index === worst ? "worst" as const : "kept" as const,
    causesDnf: value === null && time === null && index !== worst,
  }));
  return { value, entries };
}

/** Mean of `n` with no trimming — used for mo3, and for DNF-free session means. */
export function meanOf(solves: Solve[], n: number): number | null | undefined {
  if (solves.length < n) return undefined;
  const times = solves.slice(-n).map(effectiveMs);
  if (times.some((t) => t === null)) return null;
  return (times as number[]).reduce((sum, t) => sum + t, 0) / n;
}

/** Fastest single, ignoring DNFs. */
export function bestSingle(solves: Solve[]): number | undefined {
  const times = solves
    .map(effectiveMs)
    .filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : undefined;
}

export function worstSingle(solves: Solve[]): number | undefined {
  const times = solves
    .map(effectiveMs)
    .filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : undefined;
}

/** Best rolling average of `n` across the whole session. */
export function bestAverage(solves: Solve[], n: number): number | undefined {
  let best: number | undefined;
  for (let end = n; end <= solves.length; end++) {
    const avg = averageOf(solves.slice(end - n, end), n);
    if (typeof avg === "number" && (best === undefined || avg < best)) best = avg;
  }
  return best;
}

export type SessionStats = {
  count: number;
  solved: number;
  best?: number;
  worst?: number;
  mean?: number | null;
  ao5?: number | null;
  ao12?: number | null;
  ao50: LongAverage;
  ao100: LongAverage;
  bestAo5?: number;
  bestAo12?: number;
  solving?: SessionSolvingStats;
  cfop?: CfopPhaseMedian[];
};

export type LongAverage = {
  value: number | null | undefined;
  status: "actual" | "projected" | "unavailable";
  count: number;
  size: 50 | 100;
};

export type SessionSolvingStats = {
  sampleSize: number;
  /** Mean persisted slice-turn count per eligible analysed solve. */
  meanMoves: number;
  /** Total analysed slice turns divided by total analysed solving time. */
  aggregateTps: number;
  meanRecognitionMs: number;
};

export type CfopPhaseMedian = {
  name: typeof STEP_NAMES[0] | "F2L" | typeof STEP_NAMES[5] | typeof STEP_NAMES[6];
  timeMs: number;
};

function longAverage(times: (number | null)[], size: 50 | 100, baseline: number | undefined): LongAverage {
  const count = Math.min(times.length, size);
  if (count === size) {
    return { value: averageTimes(times.slice(-size)), status: "actual", count, size };
  }
  if (baseline === undefined) {
    return { value: undefined, status: "unavailable", count, size };
  }
  return {
    value: averageTimes([...times, ...new Array<number>(size - count).fill(baseline)]),
    status: "projected",
    count,
    size,
  };
}

export function analysedSolveFacts(solve: Solve): AnalysedSolveFacts | null {
  if (!isCountedSolve(solve) || effectiveMs(solve) === null) return null;
  return validatedSolveFacts(solve);
}

/** Validate recorded analysis for read-only review, independently of ranking eligibility. */
export function validatedSolveFacts(solve: Solve): AnalysedSolveFacts | null {
  const analysis = solve.analysis;
  if (!analysis) return null;
  const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
  if (
    !compatibleAnalysis(analysis, analysis)
    || !nonnegative(analysis.sliceTurns)
    || !Number.isFinite(analysis.solvingMs) || analysis.solvingMs <= 0
    || !nonnegative(analysis.totalRecognitionMs)
    || analysis.totalRecognitionMs > analysis.solvingMs
    || !nonnegative(analysis.totalExecutionMs) || analysis.totalExecutionMs > analysis.solvingMs
    || analysis.totalRecognitionMs + analysis.totalExecutionMs - analysis.solvingMs > 1e-6
    || !analysis.steps.every((step, index) =>
      nonnegative(step.timeMs) && nonnegative(step.recognitionMs) && nonnegative(step.executionMs)
      && nonnegative(step.sliceTurns) && typeof step.skipped === "boolean"
      && (step.case == null || typeof step.case === "string")
      && Number.isInteger(step.fromMove) && Number.isInteger(step.toMove)
      && step.fromMove === (index === 0 ? 0 : analysis.steps[index - 1].toMove)
      && step.toMove >= step.fromMove)
    || !Array.isArray(analysis.pauses)
    || !analysis.pauses.every((pause) => pause && Number.isInteger(pause.afterMove) && pause.afterMove >= 0
      && pause.afterMove + 1 < analysis.steps.at(-1)!.toMove
      && nonnegative(pause.startMs) && Number.isFinite(pause.durationMs) && pause.durationMs >= PAUSE_THRESHOLD_MS)
  ) return null;

  const [cross, f2lSlot1, f2lSlot2, f2lSlot3, f2lSlot4, oll, pll] = analysis.steps;
  const solvingMs = analysis.solvingMs;
  const recognitionMs = analysis.totalRecognitionMs;
  return {
    id: solve.id,
    sessionId: solve.sessionId,
    createdAt: solve.createdAt,
    rotation: analysis.rotation,
    sliceTurns: analysis.sliceTurns,
    solvingMs,
    recognitionMs,
    executionMs: analysis.totalExecutionMs,
    tps: analysis.sliceTurns / solvingMs * 1000,
    recognitionShare: recognitionMs / solvingMs,
    steps: analysis.steps,
    pauses: analysis.pauses,
    xCrossCount: leadingXCrossCount(analysis.steps),
    phases: {
      crossMs: cross.timeMs,
      f2lMs: f2lSlot1.timeMs + f2lSlot2.timeMs + f2lSlot3.timeMs + f2lSlot4.timeMs,
      ollMs: oll.timeMs,
      pllMs: pll.timeMs,
    },
  };
}

/** Count only pairs already complete at the Cross boundary, in completion order. */
export function leadingXCrossCount(steps: readonly SolveStep[]): number {
  const boundary = steps[0].toMove;
  let count = 0;
  for (const step of steps.slice(1, 5)) {
    if (step.fromMove !== boundary || step.toMove !== boundary || !(step.skipped || step.sliceTurns === 0)) break;
    count++;
  }
  return count;
}

function analysedSessionStats(solves: Solve[]): Pick<SessionStats, "solving" | "cfop"> {
  const analyses = solves.flatMap((solve) => {
    const facts = analysedSolveFacts(solve);
    return facts ? [facts] : [];
  });
  if (analyses.length === 0) return {};

  const totalMoves = analyses.reduce((sum, analysis) => sum + analysis.sliceTurns, 0);
  const totalMs = analyses.reduce((sum, analysis) => sum + analysis.solvingMs, 0);
  // STEP_NAMES is authoritative; F2L combines its four canonical steps per solve.
  const phases = [
    { name: STEP_NAMES[0], from: 0, to: 1 },
    { name: "F2L", from: 1, to: 5 },
    { name: STEP_NAMES[5], from: 5, to: 6 },
    { name: STEP_NAMES[6], from: 6, to: 7 },
  ] as const;
  return {
    solving: {
      sampleSize: analyses.length,
      meanMoves: totalMoves / analyses.length,
      aggregateTps: totalMoves / totalMs * 1000,
      meanRecognitionMs: analyses.reduce((sum, analysis) => sum + analysis.recognitionMs, 0) / analyses.length,
    },
    cfop: [
      { name: phases[0].name, timeMs: median(analyses.map((analysis) => analysis.phases.crossMs)) },
      { name: phases[1].name, timeMs: median(analyses.map((analysis) => analysis.phases.f2lMs)) },
      { name: phases[2].name, timeMs: median(analyses.map((analysis) => analysis.phases.ollMs)) },
      { name: phases[3].name, timeMs: median(analyses.map((analysis) => analysis.phases.pllMs)) },
    ],
  };
}

export function sessionStats(all: Solve[]): SessionStats {
  const solves = countedSolves(all);
  const times = solves.map(effectiveMs);
  const finished = times.filter((time): time is number => time !== null);
  const baseline = finished.length >= MIN_PROJECTION_SOLVES
    ? median(finished.slice(-MAX_PROJECTION_SOLVES))
    : undefined;
  return {
    count: solves.length,
    solved: finished.length,
    best: bestSingle(solves),
    worst: worstSingle(solves),
    mean: solves.length ? meanOf(solves, solves.length) : undefined,
    ao5: averageOf(solves, 5),
    ao12: averageOf(solves, 12),
    ao50: longAverage(times, 50, baseline),
    ao100: longAverage(times, 100, baseline),
    bestAo5: bestAverage(solves, 5),
    bestAo12: bestAverage(solves, 12),
    ...analysedSessionStats(solves),
  };
}

/** `12.34`, `1:02.34`, or `DNF`. */
export function formatTime(
  ms: number | null | undefined,
  options: { decimals?: number } = {},
): string {
  if (ms === undefined) return "—";
  if (ms === null) return "DNF";
  const decimals = options.decimals ?? 2;
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes === 0) return seconds.toFixed(decimals);
  return `${minutes}:${seconds.toFixed(decimals).padStart(decimals + 3, "0")}`;
}

export function formatSolveTime(solve: Solve): string {
  if (solve.penalty === "DNF") return `DNF(${formatTime(solve.rawMs)})`;
  const time = formatTime(effectiveMs(solve));
  return solve.penalty === "+2" ? `${time}+` : time;
}
