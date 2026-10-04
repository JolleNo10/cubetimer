import type { TrainingRecognitionAttempt } from "../../app/types";
import { trainingCatalogueCaseId, trainingCatalogueKey } from "../../app/trainingCatalogue";
import type { TrainingCaseStats } from "./trainingPerformance";

export function recognitionIsCorrect(attempt: Pick<TrainingRecognitionAttempt, "target" | "answerCaseId">): boolean {
  return trainingCatalogueCaseId(attempt.target) === attempt.answerCaseId;
}

export function trainingMedian(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function recognitionPerformance(attempts: readonly TrainingRecognitionAttempt[]) {
  const sorted = [...attempts].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const recent = sorted.slice(-5), correct = sorted.filter(recognitionIsCorrect), recentCorrect = recent.filter(recognitionIsCorrect);
  const validResponse = (n: number) => Number.isFinite(n) && n >= 0;
  const times = correct.map(a => a.responseMs).filter(validResponse), bestCorrectResponseMs = times.length ? times.reduce((best, time) => Math.min(best, time)) : null;
  const recentMedianCorrectResponseMs = trainingMedian(recentCorrect.map(a => a.responseMs).filter(validResponse));
  const accuracy = sorted.length ? correct.length / sorted.length : null;
  const recentAccuracy = recent.length ? recentCorrect.length / recent.length : null;
  const needsReview = recentAccuracy !== null && recentAccuracy < 0.8 ||
    bestCorrectResponseMs !== null && recentMedianCorrectResponseMs !== null && recentMedianCorrectResponseMs > bestCorrectResponseMs * 1.2;
  const status: TrainingCaseStats["status"] = !sorted.length ? "new" : sorted.length < 3 ? "learning" : needsReview ? "review" : "practiced";
  return { attempts: sorted.length, correct: correct.length, incorrect: sorted.length - correct.length,
    accuracy, recentAccuracy, bestCorrectResponseMs, recentMedianCorrectResponseMs,
    medianCorrectResponseMs: trainingMedian(times), recentWrongCount: recent.length - recentCorrect.length,
    lastPracticedAt: sorted.at(-1)?.createdAt ?? null, status };
}
export type TrainingRecognitionStats = ReturnType<typeof recognitionPerformance>;
export const EMPTY_RECOGNITION_STATS = recognitionPerformance([]);

export function recognitionTimingRatio(stats: Pick<TrainingRecognitionStats, "bestCorrectResponseMs" | "recentMedianCorrectResponseMs">): number | null {
  const best = stats.bestCorrectResponseMs, recent = stats.recentMedianCorrectResponseMs;
  if (best === null || recent === null || !Number.isFinite(best) || !Number.isFinite(recent) || best <= 0 || recent <= 0) return null;
  const ratio = recent / best;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Explicit wrong answers only; never infer confusions from execution or skips. */
export function recognitionConfusions(attempts: readonly TrainingRecognitionAttempt[]) {
  const counts = new Map<string, { target: TrainingRecognitionAttempt["target"]; answerCaseId: string; count: number }>();
  for (const row of attempts.filter(a => !recognitionIsCorrect(a))) {
    const key = JSON.stringify([trainingCatalogueKey(row.target), row.answerCaseId]);
    const entry = counts.get(key) ?? { target: row.target, answerCaseId: row.answerCaseId, count: 0 };
    entry.count++; counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count ||
    trainingCatalogueKey(a.target).localeCompare(trainingCatalogueKey(b.target)) || a.answerCaseId.localeCompare(b.answerCaseId));
}

export function recognitionStatsByCase(attempts: readonly TrainingRecognitionAttempt[]): Map<string, TrainingRecognitionStats> {
  const grouped = new Map<string, TrainingRecognitionAttempt[]>();
  for (const attempt of attempts) {
    const key = trainingCatalogueKey(attempt.target), rows = grouped.get(key) ?? [];
    rows.push(attempt); grouped.set(key, rows);
  }
  return new Map([...grouped].map(([key, rows]) => [key, recognitionPerformance(rows)]));
}
