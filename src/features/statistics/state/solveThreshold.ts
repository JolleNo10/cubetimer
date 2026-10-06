import { effectiveMs, type Settings, type Solve } from "../../../app/types";
import { isCountedSolve, percentile } from "./stats";

export type SolveThresholdSettings = Pick<Settings, "slowSolveThreshold" | "slowSolveHandling">;
export const MIN_THRESHOLD_SOLVES = 5;
export const THRESHOLD_WINDOW = 20;

/** Reversible classification from raw facts, in chronological order per Session. */
export function applySolveThreshold(solves: readonly Solve[], settings: SolveThresholdSettings): Solve[] {
  const projected = new Map<string, Solve>();
  const histories = new Map<string, number[]>();
  for (const original of [...solves].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const { statisticsOutlier: previous, ...raw } = original;
    let solve: Solve = previous ? raw : original;
    const time = effectiveMs(solve);
    if (settings.slowSolveHandling !== "off" && isCountedSolve(solve) && time !== null && Number.isFinite(time) && time > 0) {
      const history = histories.get(solve.sessionId) ?? [];
      const baselineMs = history.length >= MIN_THRESHOLD_SOLVES ? percentile(history, 0.5)! : null;
      if (baselineMs !== null && time > baselineMs * settings.slowSolveThreshold) {
        solve = { ...solve, statisticsOutlier: { action: settings.slowSolveHandling, baselineMs, multiplier: settings.slowSolveThreshold } };
      } else {
        histories.set(solve.sessionId, [...history, time].slice(-THRESHOLD_WINDOW));
      }
    }
    projected.set(solve.id, solve);
  }
  return solves.map(solve => projected.get(solve.id)!);
}
