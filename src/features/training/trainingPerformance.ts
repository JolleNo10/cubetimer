import { trainingCatalogueKey, catalogueIdentityForTarget } from "../../app/trainingCatalogue";
import type { TrainingAttempt, TrainingAttemptTarget, TrainingCatalogueIdentity } from "../../app/types";
import type { TrainingTargetInfo } from "./TrainingRuntime";

export type TrainingCatalogueCase = TrainingCatalogueIdentity & { origin: "catalog" };

export function catalogueCaseForTarget(target: TrainingTargetInfo | null): TrainingCatalogueCase | null {
  const identity = catalogueIdentityForTarget(target);
  return identity ? { ...identity, origin: "catalog" } : null;
}

/** JSON tuple encoding is shared by all catalogue-owned user records. */
export function trainingCaseKey(target: TrainingAttemptTarget | TrainingCatalogueCase): string | null {
  return target.origin === "catalog" ? trainingCatalogueKey(target) : null;
}

export type TrainingCaseStats = {
  attempts: number;
  bestMoveSpanMs: number | null;
  recentMedianMoveSpanMs: number | null;
  bestCaseTimeMs: number | null;
  recentMedianCaseTimeMs: number | null;
  bestStm: number | null;
  recentMedianDelta: number | null;
  lastPracticedAt: number | null;
  status: "new" | "learning" | "review" | "practiced";
  recentMoveSpansMs: readonly number[];
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export const trainingDurationIsValid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;
export const effectiveTrainingDelta = (attempt: Pick<TrainingAttempt, "preferredDelta" | "delta">) => attempt.preferredDelta ?? attempt.delta;

export function trainingExecutionPerformance(attempts: readonly TrainingAttempt[]): TrainingCaseStats {
  const sorted = [...attempts].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const recent = sorted.slice(-5);
  const times = sorted.map(a => a.elapsedMs).filter(trainingDurationIsValid);
  const stms = sorted.map(a => a.stm).filter(n => Number.isFinite(n) && n >= 0);
  const recentMoveSpansMs = recent.map(a => a.elapsedMs).filter(trainingDurationIsValid);
  const bestMoveSpanMs = times.length ? times.reduce((best, time) => Math.min(best, time)) : null;
  const recentMedianMoveSpanMs = median([...recentMoveSpansMs]);
  const recentMedianDelta = median(recent.map(effectiveTrainingDelta).filter((n): n is number => n !== null && Number.isFinite(n)));
  const caseTimes = sorted.filter(a => a.activity === "drill").map(a => a.caseTimeMs).filter(trainingDurationIsValid);
  const bestCaseTimeMs = caseTimes.length ? caseTimes.reduce((best, time) => Math.min(best, time)) : null;
  const recentMedianCaseTimeMs = median(recent.filter(a => a.activity === "drill").map(a => a.caseTimeMs).filter(trainingDurationIsValid));
  const timingRatio = trainingTimingRatio({ bestCaseTimeMs, recentMedianCaseTimeMs, bestMoveSpanMs, recentMedianMoveSpanMs });
  const needsReview = recentMedianDelta !== null && recentMedianDelta > 0 ||
    timingRatio !== null && timingRatio > 1.2;
  return { attempts: sorted.length, bestMoveSpanMs, recentMedianMoveSpanMs, bestCaseTimeMs, recentMedianCaseTimeMs,
    bestStm: stms.length ? stms.reduce((best, stm) => Math.min(best, stm)) : null, recentMedianDelta,
    lastPracticedAt: sorted.at(-1)?.createdAt ?? null,
    status: !sorted.length ? "new" : sorted.length < 3 ? "learning" : needsReview ? "review" : "practiced",
    recentMoveSpansMs };
}

export const EMPTY_TRAINING_CASE_STATS: TrainingCaseStats = trainingExecutionPerformance([]);

export function trainingStatsByCase(attempts: readonly TrainingAttempt[]): Map<string, TrainingCaseStats> {
  const grouped = new Map<string, TrainingAttempt[]>();
  for (const attempt of attempts) {
    const key = trainingCaseKey(attempt.target);
    if (key === null) continue;
    const group = grouped.get(key) ?? [];
    group.push(attempt); grouped.set(key, group);
  }
  return new Map([...grouped].map(([key, rows]) => [key, trainingExecutionPerformance(rows)]));
}

/** Review tiers are feature policy; selection never constructs a Training target. */
export function selectTrainingReview(
  cases: readonly TrainingCatalogueCase[], current: TrainingCatalogueCase | null,
  attempts: readonly TrainingAttempt[], rng: () => number = Math.random,
): TrainingCatalogueCase | null {
  const stats = trainingStatsByCase(attempts);
  const entries = cases.map((target, order) => ({ target, order, key: trainingCaseKey(target)!,
    stats: stats.get(trainingCaseKey(target)!) ?? EMPTY_TRAINING_CASE_STATS }));
  const currentKey = current ? trainingCaseKey(current) : null;
  const avoidCurrent = (pool: typeof entries) => pool.length > 1 ? pool.filter(e => e.key !== currentKey) : pool;
  const unseen = entries.filter(e => !e.stats.attempts);
  if (unseen.length) {
    const pool = avoidCurrent(unseen);
    return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)))].target;
  }
  const learning = entries.filter(e => e.stats.attempts < 3);
  const oldest = (a: typeof entries[number], b: typeof entries[number]) =>
    (a.stats.lastPracticedAt ?? -Infinity) - (b.stats.lastPracticedAt ?? -Infinity) || a.order - b.order;
  if (learning.length) {
    const count = Math.min(...learning.map(e => e.stats.attempts));
    return avoidCurrent(learning.filter(e => e.stats.attempts === count)).sort(oldest)[0].target;
  }
  const review = entries.filter(e => e.stats.status === "review");
  const ratio = trainingTimingRatio;
  // Null ranks after real metrics, including zero or negative deltas.
  const worseFirst = (a: number | null, b: number | null) =>
    a === null ? b === null ? 0 : 1 : b === null ? -1 : b - a;
  const pool = review.length ? avoidCurrent(review).sort((a, b) =>
    worseFirst(a.stats.recentMedianDelta, b.stats.recentMedianDelta) ||
    worseFirst(ratio(a.stats), ratio(b.stats)) || oldest(a, b)) : avoidCurrent(entries).sort(oldest);
  return pool[0]?.target ?? null;
}

/** Prefer complete Drill case timing when both metrics are available. */
export function trainingTimingRatio(stats: Pick<TrainingCaseStats, "bestCaseTimeMs" | "recentMedianCaseTimeMs" | "bestMoveSpanMs" | "recentMedianMoveSpanMs">): number | null {
  const ratio = trainingDurationIsValid(stats.bestCaseTimeMs) && trainingDurationIsValid(stats.recentMedianCaseTimeMs)
    ? stats.recentMedianCaseTimeMs / stats.bestCaseTimeMs :
    trainingDurationIsValid(stats.bestMoveSpanMs) && trainingDurationIsValid(stats.recentMedianMoveSpanMs)
      ? stats.recentMedianMoveSpanMs / stats.bestMoveSpanMs : null;
  return ratio !== null && Number.isFinite(ratio) ? ratio : null;
}
