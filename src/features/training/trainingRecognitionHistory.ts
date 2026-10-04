import type { TrainingRecognitionAttempt } from "../../app/types";
import * as db from "../../infrastructure/persistence/db";

export type CompletedTrainingRecognition = Omit<TrainingRecognitionAttempt, "id" | "createdAt">;

export function createTrainingRecognitionAttempt(fact: CompletedTrainingRecognition): TrainingRecognitionAttempt {
  const attempt = db.normalizeTrainingRecognitionAttempt({ ...fact, id: crypto.randomUUID(), createdAt: Date.now() });
  if (!attempt) throw new Error("Invalid Recognition completion.");
  return attempt;
}
export function loadTrainingRecognitionAttempts() { return db.loadTrainingRecognitionAttempts(); }
export function saveTrainingRecognitionAttempt(attempt: TrainingRecognitionAttempt) { return db.saveTrainingRecognitionAttempt(attempt); }
