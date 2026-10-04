import { trainingCatalogueKey } from "../../app/trainingCatalogue";
import { EMPTY_RECOGNITION_STATS, recognitionStatsByCase, trainingMedian, type TrainingRecognitionStats } from "./trainingRecognitionPerformance";
import type { TrainingAttempt, TrainingDrillPresetContext, TrainingDrillStrategy, TrainingDrillTask, TrainingCatalogueIdentity, TrainingRecognitionAttempt } from "../../app/types";
import { f2lTrainingCatalogue, findF2lTrainingCase, shortF2lCaseLabel, type F2lTrainingCase } from "../../cube/f2lTrainingCases";
import { lastLayerCaseCatalogue } from "../../cube/lastLayerTraining";
import { EMPTY_TRAINING_CASE_STATS, trainingCaseKey, trainingStatsByCase, trainingTimingRatio, type TrainingCaseStats, type TrainingCatalogueCase } from "./trainingPerformance";

export type { TrainingDrillStrategy } from "../../app/types";
export type TrainingDrillContext = TrainingDrillPresetContext;
export type TrainingDrillState = {
  strategy: TrainingDrillStrategy;
  task: TrainingDrillTask;
  runId: string | null;
  selectedCaseIds: string[];
  running: boolean;
  status: "configuring" | "running" | "summary";
  outcomes: TrainingDrillRoundOutcome[];
  round: number;
  context: TrainingDrillContext | null;
  lastCaseId: string | null;
  lastOutcome: "solved" | "skipped" | "correct" | "incorrect" | null;
};

/** Catalogue order is authoritative, independently of selection click order. */
export function drillCatalogue(context: TrainingDrillContext): TrainingCatalogueCase[] {
  const groupedOrder = <T extends { group: string }>(cases: readonly T[]) =>
    [...new Set(cases.map(c => c.group))].flatMap(group => cases.filter(c => c.group === group));
  return context.family === "f2l"
    ? groupedOrder<F2lTrainingCase>(f2lTrainingCatalogue(context.library).cases).map(c => ({ ...context, origin: "catalog", caseName: c.name }))
    : groupedOrder(lastLayerCaseCatalogue(context.family, context.trainingSet)).map(c => ({ ...context, origin: "catalog", caseId: c.caseId }));
}

export function drillCaseId(target: TrainingCatalogueCase): string {
  return target.family === "f2l" ? target.caseName : target.caseId;
}

export type TrainingDrillRoundOutcome =
  | { caseId: string; outcome: "solved"; caseTimeMs: number; moveSpanMs: number; stm: number; delta: number | null; completedAt: number }
  | { caseId: string; outcome: "skipped"; completedAt: number }
  | { caseId: string; outcome: "answered"; answerCaseId: string; correct: boolean; responseMs: number; completedAt: number };

const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const positive = (value: number) => Number.isFinite(value) && value > 0;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = values.sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Current-run signals never change persisted case status. The last five outcomes
 * bound skip influence; solved weakness uses the same capped adjustments as history. */
export function drillRunCaseStats(outcomes: readonly TrainingDrillRoundOutcome[]) {
  const solved = outcomes.filter(o => o.outcome === "solved");
  const recent = outcomes.slice(-5).filter(o => o.outcome === "solved");
  const times = solved.map(o => o.caseTimeMs).filter(positive);
  return {
    solved: solved.length, skipped: outcomes.filter(o => o.outcome === "skipped").length,
    recentSkipped: outcomes.slice(-5).filter(o => o.outcome === "skipped").length,
    latestOutcome: outcomes.at(-1)?.outcome ?? null,
    averageCaseTimeMs: mean(times), bestCaseTimeMs: times.length ? times.reduce((best, time) => Math.min(best, time)) : null,
    recentMedianCaseTimeMs: median(recent.map(o => o.caseTimeMs).filter(positive)),
    recentMedianDelta: median(recent.map(o => o.delta).filter((n): n is number => n !== null && Number.isFinite(n))),
  };
}

export function drillCaseWeight(stats: TrainingCaseStats, outcomes: readonly TrainingDrillRoundOutcome[] = []): number {
  const base = { practiced: 1, learning: 3, new: 4, review: 6 }[stats.status];
  const run = drillRunCaseStats(outcomes);
  // Solved outcomes also enter persisted history immediately. Taking the stronger
  // signal avoids counting the same completion's weakness twice.
  const delta = Math.max(0, stats.recentMedianDelta ?? 0, run.recentMedianDelta ?? 0);
  const best = stats.bestCaseTimeMs ?? run.bestCaseTimeMs;
  const runRatio = best !== null && run.recentMedianCaseTimeMs !== null ? run.recentMedianCaseTimeMs / best : null;
  const ratio = Math.max(1, trainingTimingRatio(stats) ?? 1, runRatio ?? 1);
  return base + Math.min(12, run.recentSkipped * 6) + (delta !== null && delta > 0 ? Math.min(4, delta) : 0) +
    (ratio !== null && ratio > 1 ? Math.min(4, (ratio - 1) * 5) : 0);
}

/** Pure draw over the selected pool; no target construction, clocks or persistence. */
export function selectDrillCase(
  cases: readonly TrainingCatalogueCase[], strategy: TrainingDrillStrategy,
  round: number, previousCaseId: string | null, attempts: readonly TrainingAttempt[],
  rng: () => number = Math.random, outcomes: readonly TrainingDrillRoundOutcome[] = [],
): TrainingCatalogueCase | null {
  if (!cases.length) return null;
  if (strategy === "sequence") return cases[round % cases.length];
  const pool = cases.length > 1 ? cases.filter(c => drillCaseId(c) !== previousCaseId) : cases;
  const stats = strategy === "weighted" ? trainingStatsByCase(attempts) : null;
  const weights = pool.map(c => stats ? drillCaseWeight(stats.get(trainingCaseKey(c)!) ?? EMPTY_TRAINING_CASE_STATS, outcomes.filter(o => o.caseId === drillCaseId(c))) : 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let draw = Math.max(0, Math.min(1, rng())) * total;
  for (let i = 0; i < pool.length; i++) {
    draw -= weights[i];
    if (draw < 0) return pool[i];
  }
  return pool.at(-1)!;
}


/** Completed rounds only; the currently revealed/incomplete round is not a result. */
export function trainingDrillSummary(outcomes: readonly TrainingDrillRoundOutcome[]) {
  const solved = outcomes.filter(o => o.outcome === "solved");
  const times = solved.map(o => o.caseTimeMs).filter(positive);
  return {
    rounds: outcomes.length, solved: solved.length, skipped: outcomes.length - solved.length,
    averageCaseTimeMs: mean(times), bestCaseTimeMs: times.length ? times.reduce((best, time) => Math.min(best, time)) : null,
    averageStm: mean(solved.map(o => o.stm).filter(n => Number.isFinite(n) && n >= 0)),
  };
}

/** Transparent ranking within the run's selected catalogue. Skip count, timing
 * regression, STM weakness, historical review, then stable catalogue order. */
export function weakDrillCases(cases: readonly TrainingCatalogueCase[], outcomes: readonly TrainingDrillRoundOutcome[],
  attempts: readonly TrainingAttempt[], limit = 5) {
  const history = trainingStatsByCase(attempts);
  const runAverage = trainingDrillSummary(outcomes).averageCaseTimeMs;
  return cases.map((target, order) => {
    const caseId = drillCaseId(target);
    const run = drillRunCaseStats(outcomes.filter(o => o.caseId === caseId));
    const stats = history.get(trainingCaseKey(target)!) ?? EMPTY_TRAINING_CASE_STATS;
    // Already-persisted outcomes must not mask slow first-run cases: compare
    // against both the historical PB and the overall run, taking the larger regression.
    const baselines = [stats.bestCaseTimeMs, runAverage].filter((n): n is number => n !== null && n > 0);
    const baseline = baselines.length ? Math.min(...baselines) : null;
    const ratio = baseline !== null && baseline > 0 && run.averageCaseTimeMs !== null ? run.averageCaseTimeMs / baseline : null;
    return { target, caseId, order, ...run, timingRatio: ratio, historicalReview: stats.status === "review" };
  }).filter(c => c.skipped > 0 || (c.timingRatio !== null && c.timingRatio > 1.2) ||
    (c.recentMedianDelta !== null && c.recentMedianDelta > 0) || c.historicalReview)
    .sort((a, b) => b.skipped - a.skipped || Math.max(0, (b.timingRatio ?? 1) - 1) - Math.max(0, (a.timingRatio ?? 1) - 1) ||
      Math.max(0, b.recentMedianDelta ?? 0) - Math.max(0, a.recentMedianDelta ?? 0) || Number(b.historicalReview) - Number(a.historicalReview) || a.order - b.order)
    .slice(0, Math.max(0, limit));
}


export function drillCaseMetadata(identity: TrainingCatalogueIdentity) {
  if (identity.family === "f2l") {
    const item = findF2lTrainingCase(identity.library, identity.caseName)!;
    return { caseId: item.name, label: shortF2lCaseLabel(item.name), group: item.group };
  }
  const item = lastLayerCaseCatalogue(identity.family, identity.trainingSet).find(c => c.caseId === identity.caseId)!;
  return { caseId: item.caseId, label: item.caseId, group: item.group };
}

/** A single recognition focus needs one distractor from this captured catalogue.
 * Group affinity first, then authoritative catalogue order; never invent a weak case. */
export function recognitionCasePool(cases: readonly TrainingCatalogueCase[], primaryIds: readonly string[]) {
  const primary = cases.filter(c => primaryIds.includes(drillCaseId(c)));
  if (!primary.length) return null;
  if (primary.length >= 2) return { caseIds: primary.map(drillCaseId), supportCaseId: null };
  const group = drillCaseMetadata(primary[0]).group;
  const others = cases.filter(c => drillCaseId(c) !== drillCaseId(primary[0]));
  const support = others.find(c => drillCaseMetadata(c).group === group) ?? others[0];
  if (!support) return null;
  const supportCaseId = drillCaseId(support);
  return { caseIds: cases.map(drillCaseId).filter(id => id === drillCaseId(primary[0]) || id === supportCaseId), supportCaseId };
}

function shuffled<T>(values: readonly T[], rng: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Text choices come only from the selected pool; catalogue groups own distractor affinity. */
export function recognitionChoices(cases: readonly TrainingCatalogueCase[], target: TrainingCatalogueCase, rng: () => number) {
  const correct = drillCaseMetadata(target), other = cases.map(drillCaseMetadata).filter(c => c.caseId !== correct.caseId);
  const distractors = [...shuffled(other.filter(c => c.group === correct.group), rng),
    ...shuffled(other.filter(c => c.group !== correct.group), rng)].slice(0, 3);
  return shuffled([correct, ...distractors], rng);
}

export function recognitionDrillSummary(outcomes: readonly TrainingDrillRoundOutcome[]) {
  const answered = outcomes.filter(o => o.outcome === "answered"), correct = answered.filter(o => o.correct);
  return { rounds: outcomes.length, answered: answered.length, correct: correct.length, incorrect: answered.length - correct.length,
    skipped: outcomes.filter(o => o.outcome === "skipped").length,
    accuracy: answered.length ? correct.length / answered.length : null,
    medianCorrectResponseMs: trainingMedian(correct.map(o => o.responseMs)),
    bestCorrectResponseMs: correct.length ? Math.min(...correct.map(o => o.responseMs)) : null };
}

export function recognitionCaseWeight(stats: TrainingRecognitionStats, outcomes: readonly TrainingDrillRoundOutcome[] = []): number {
  const recent = outcomes.slice(-5), run = recognitionDrillSummary(recent);
  const wrong = Math.max(stats.recentWrongCount, run.incorrect);
  const best = stats.bestCorrectResponseMs ?? run.bestCorrectResponseMs;
  const runRatio = best !== null && run.medianCorrectResponseMs !== null
    ? best === 0 ? run.medianCorrectResponseMs > 0 ? 2 : 1 : run.medianCorrectResponseMs / best : 1;
  const historyRatio = stats.bestCorrectResponseMs !== null && stats.recentMedianCorrectResponseMs !== null
    ? stats.bestCorrectResponseMs === 0 ? stats.recentMedianCorrectResponseMs > 0 ? 2 : 1 : stats.recentMedianCorrectResponseMs / stats.bestCorrectResponseMs : 1;
  return { new: 4, learning: 3, review: 6, practiced: 1 }[stats.status] + Math.min(8, wrong * 2) +
    Math.min(12, run.skipped * 6) + Math.min(4, Math.max(0, Math.max(runRatio, historyRatio) - 1) * 5);
}

export function selectRecognitionDrillCase(cases: readonly TrainingCatalogueCase[], strategy: TrainingDrillStrategy,
  round: number, previousCaseId: string | null, attempts: readonly TrainingRecognitionAttempt[],
  rng: () => number, outcomes: readonly TrainingDrillRoundOutcome[]): TrainingCatalogueCase | null {
  if (!cases.length) return null;
  if (strategy === "sequence") return cases[round % cases.length];
  const pool = cases.length > 1 ? cases.filter(c => drillCaseId(c) !== previousCaseId) : cases;
  const history = recognitionStatsByCase(attempts);
  const weights = pool.map(c => strategy === "weighted" ? recognitionCaseWeight(history.get(trainingCatalogueKey(c)) ?? EMPTY_RECOGNITION_STATS,
    outcomes.filter(o => o.caseId === drillCaseId(c))) : 1);
  let draw = Math.max(0, Math.min(1, rng())) * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < pool.length; i++) { draw -= weights[i]; if (draw < 0) return pool[i]; }
  return pool.at(-1)!;
}

export function weakRecognitionDrillCases(cases: readonly TrainingCatalogueCase[], outcomes: readonly TrainingDrillRoundOutcome[],
  attempts: readonly TrainingRecognitionAttempt[], limit = 5) {
  const history = recognitionStatsByCase(attempts);
  return cases.map((target, order) => {
    const caseId = drillCaseId(target), run = recognitionDrillSummary(outcomes.filter(o => o.caseId === caseId));
    const stats = history.get(trainingCatalogueKey(target)) ?? EMPTY_RECOGNITION_STATS;
    const ratio = stats.bestCorrectResponseMs !== null && run.medianCorrectResponseMs !== null
      ? stats.bestCorrectResponseMs === 0 ? run.medianCorrectResponseMs > 0 ? 2 : 1 : run.medianCorrectResponseMs / stats.bestCorrectResponseMs : null;
    return { target, caseId, order, runIncorrect: run.incorrect, runSkipped: run.skipped,
      historicalRecentWrongCount: stats.recentWrongCount, effectiveWrongSignal: Math.max(run.incorrect, stats.recentWrongCount),
      accuracy: run.accuracy ?? stats.recentAccuracy, timingRatio: ratio, historicalReview: stats.status === "review" };
  }).filter(c => c.effectiveWrongSignal || c.runSkipped || c.timingRatio !== null && c.timingRatio > 1.2 || c.historicalReview)
    .sort((a, b) => b.effectiveWrongSignal - a.effectiveWrongSignal || (a.accuracy ?? 1) - (b.accuracy ?? 1) || b.runSkipped - a.runSkipped ||
      (b.timingRatio ?? 1) - (a.timingRatio ?? 1) || Number(b.historicalReview) - Number(a.historicalReview) || a.order - b.order)
    .slice(0, Math.max(0, limit));
}
