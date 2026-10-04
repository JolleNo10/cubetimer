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
  const times = correct.map(a => a.responseMs), bestCorrectResponseMs = times.length ? times.reduce((best, time) => Math.min(best, time)) : null;
  const recentMedianCorrectResponseMs = trainingMedian(recentCorrect.map(a => a.responseMs));
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

export function recognitionStatsByCase(attempts: readonly TrainingRecognitionAttempt[]): Map<string, TrainingRecognitionStats> {
  const grouped = new Map<string, TrainingRecognitionAttempt[]>();
  for (const attempt of attempts) {
    const key = trainingCatalogueKey(attempt.target), rows = grouped.get(key) ?? [];
    rows.push(attempt); grouped.set(key, rows);
  }
  return new Map([...grouped].map(([key, rows]) => [key, recognitionPerformance(rows)]));
}
