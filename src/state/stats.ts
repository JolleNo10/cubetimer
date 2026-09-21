import { effectiveMs, type Solve } from "./types";

/**
 * WCA average of `n`: drop the fastest and slowest result, mean the rest.
 * A single DNF counts as the slowest result and is dropped; two or more make the
 * average a DNF. Returns `null` for DNF and `undefined` when there are too few solves.
 */
export function averageOf(solves: Solve[], n: number): number | null | undefined {
  if (solves.length < n) return undefined;
  const window = solves.slice(-n);
  const times = window.map(effectiveMs);
  const dnfs = times.filter((t) => t === null).length;
  if (dnfs > 1) return null;

  const finished = times.filter((t): t is number => t !== null).sort((a, b) => a - b);
  // Trim one from each end; a DNF has already taken the slow slot.
  const trimmed = dnfs === 1 ? finished.slice(1) : finished.slice(1, -1);
  if (trimmed.length === 0) return null;
  return trimmed.reduce((sum, t) => sum + t, 0) / trimmed.length;
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
    const avg = averageOf(solves.slice(0, end), n);
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
  ao50?: number | null;
  ao100?: number | null;
  bestAo5?: number;
  bestAo12?: number;
  /** Median moves per solve and average turns per second, smart cube solves only. */
  averageMoves?: number;
  averageTps?: number;
};

export function sessionStats(solves: Solve[]): SessionStats {
  const finished = solves.filter((s) => s.penalty !== "DNF");
  const withMoves = solves.filter((s) => s.moves.length > 0 && s.penalty !== "DNF");
  const totalMoves = withMoves.reduce((sum, s) => sum + s.moves.length, 0);
  const totalMs = withMoves.reduce((sum, s) => sum + s.rawMs, 0);
  return {
    count: solves.length,
    solved: finished.length,
    best: bestSingle(solves),
    worst: worstSingle(solves),
    mean: solves.length ? meanOf(solves, solves.length) : undefined,
    ao5: averageOf(solves, 5),
    ao12: averageOf(solves, 12),
    ao50: averageOf(solves, 50),
    ao100: averageOf(solves, 100),
    bestAo5: bestAverage(solves, 5),
    bestAo12: bestAverage(solves, 12),
    averageMoves: withMoves.length ? totalMoves / withMoves.length : undefined,
    averageTps: totalMs > 0 ? (totalMoves / totalMs) * 1000 : undefined,
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
