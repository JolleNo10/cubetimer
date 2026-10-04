import type { TrainingAttempt, TrainingDrillPresetContext, TrainingRecognitionAttempt } from "../../app/types";
import { trainingCatalogueKey } from "../../app/trainingCatalogue";
import { drillCatalogue, drillCaseMetadata } from "./trainingDrill";
import { EMPTY_TRAINING_CASE_STATS, trainingStatsByCase, trainingTimingRatio } from "./trainingPerformance";
import { EMPTY_RECOGNITION_STATS, recognitionConfusions, recognitionStatsByCase, recognitionTimingRatio } from "./trainingRecognitionPerformance";

export const TRAINING_STAGES = ["new", "learning", "recall", "reliable", "fast", "maintenance"] as const;
export type TrainingCurriculumStage = typeof TRAINING_STAGES[number];
export const TRAINING_REVIEW_INTERVALS = { new: 0, learning: 0, recall: 0, reliable: 86400000, fast: 259200000, maintenance: 604800000 };

/** Derivation only: catalogue identity and immutable histories are the entire evidence. */
export function trainingCurriculum(context: TrainingDrillPresetContext, execution: readonly TrainingAttempt[],
  recognition: readonly TrainingRecognitionAttempt[], now: number) {
  const executionStats = trainingStatsByCase(execution), recognitionStats = recognitionStatsByCase(recognition);
  const firstPractice = new Map<string, number>(), confusionCounts = new Map<string, number>();
  const practice = execution.flatMap(a => a.target.origin === "catalog" ? [{ key: trainingCatalogueKey(a.target), createdAt: a.createdAt }] : []);
  practice.push(...recognition.map(a => ({ key: trainingCatalogueKey(a.target), createdAt: a.createdAt })));
  for (const row of practice) {
    firstPractice.set(row.key, Math.min(firstPractice.get(row.key) ?? row.createdAt, row.createdAt));
  }
  for (const confusion of recognitionConfusions(recognition)) {
    const key = trainingCatalogueKey(confusion.target);
    confusionCounts.set(key, (confusionCounts.get(key) ?? 0) + confusion.count);
  }
  const cases = drillCatalogue(context).map((target, order) => {
    const key = trainingCatalogueKey(target), e = executionStats.get(key) ?? EMPTY_TRAINING_CASE_STATS,
      r = recognitionStats.get(key) ?? EMPTY_RECOGNITION_STATS;
    const executionTimingRatio = trainingTimingRatio(e), recognitionRatio = recognitionTimingRatio(r);
    const practicedTimes = [e.lastPracticedAt, r.lastPracticedAt].filter((n): n is number => n !== null);
    const lastPracticedAt = practicedTimes.length ? Math.max(...practicedTimes) : null;
    const firstPracticedAt = firstPractice.get(key) ?? null;
    const historySpanMs = firstPracticedAt !== null && lastPracticedAt !== null ? lastPracticedAt - firstPracticedAt : 0;
    const introduced = e.attempts > 0 || r.attempts > 0;
    const fast = e.status === "practiced" && r.status === "practiced" && e.attempts >= 5 && r.attempts >= 5 &&
      r.recentAccuracy === 1 && (recognitionRatio === null || recognitionRatio <= 1.15) &&
      (executionTimingRatio === null || executionTimingRatio <= 1.15) && (e.recentMedianDelta === null || e.recentMedianDelta <= 0);
    // Execution review with established recognition remains Reliable, with an
    // explicit execution weakness. Recognition review regresses to Recall.
    const stage: TrainingCurriculumStage = !introduced ? "new" : r.attempts < 3 ? "learning" :
      r.status !== "practiced" || e.attempts < 3 ? "recall" : !fast ? "reliable" :
      e.attempts >= 10 && r.attempts >= 10 && historySpanMs >= TRAINING_REVIEW_INTERVALS.maintenance ? "maintenance" : "fast";
    const dueAt = TRAINING_REVIEW_INTERVALS[stage] === 0 ? now : lastPracticedAt! + TRAINING_REVIEW_INTERVALS[stage];
    const recognitionWeak = r.recentWrongCount > 0 || r.status === "review" || (recognitionRatio !== null && recognitionRatio > 1.2);
    const executionWeak = e.status === "review" || (e.recentMedianDelta !== null && e.recentMedianDelta > 0) ||
      (executionTimingRatio !== null && executionTimingRatio > 1.2);
    return { key, target, order, ...drillCaseMetadata(target), stage, introduced, execution: e, recognition: r,
      executionTimingRatio, recognitionTimingRatio: recognitionRatio, firstPracticedAt, lastPracticedAt, historySpanMs,
      confusionCount: confusionCounts.get(key) ?? 0, recognitionWeak, executionWeak, dueAt, due: now >= dueAt };
  });
  const need = (c: typeof cases[number]) => Number(c.recognitionWeak) + Number(c.executionWeak);
  const active = cases.filter(c => c.stage === "learning" || c.stage === "recall").sort((a, b) =>
    need(b) - need(a) || b.recognition.recentWrongCount - a.recognition.recentWrongCount ||
    Math.max(0, b.execution.recentMedianDelta ?? 0) - Math.max(0, a.execution.recentMedianDelta ?? 0) || a.order - b.order).slice(0, 4);
  const activeCohort = [...active, ...cases.filter(c => c.stage === "new").slice(0, 4 - active.length)];
  const stageCounts = Object.fromEntries(TRAINING_STAGES.map(stage => [stage, cases.filter(c => c.stage === stage).length])) as Record<TrainingCurriculumStage, number>;
  return { context, cases, activeCohort, stageCounts, dueCount: cases.filter(c => c.due && isEstablishedTrainingCase(c)).length };
}
export type TrainingCurriculum = ReturnType<typeof trainingCurriculum>;
export type TrainingCurriculumCase = TrainingCurriculum["cases"][number];
export const isEstablishedTrainingCase = (c: { stage: TrainingCurriculumStage }): boolean =>
  c.stage === "reliable" || c.stage === "fast" || c.stage === "maintenance";
