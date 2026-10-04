import type { TrainingAttempt, TrainingAttemptTarget } from "../../app/types";
import * as db from "../../infrastructure/persistence/db";
import type { CompletedTrainingAttempt } from "./TrainingRuntime";

/** Snapshot the completed target before any virtual reload randomizes it. */
export function createTrainingAttempt({ mode, target: t, result }: CompletedTrainingAttempt): TrainingAttempt {
  let target: TrainingAttemptTarget;
  if (t.family === "f2l") {
    target = t.origin.kind === "catalog"
      ? { family: "f2l", origin: "catalog", library: t.origin.library, caseName: t.origin.caseName, position: t.position }
      : { family: "f2l", origin: "solve-step", solveId: t.origin.solveId, stepName: t.origin.stepName, position: t.position,
        ...(t.references[0]?.caseName ? { recognizedCaseName: t.references[0].caseName } : {}) };
  } else {
    target = t.origin.kind === "catalog"
      ? { family: t.family, origin: "catalog", trainingSet: t.trainingSet, caseId: t.caseId, auf: t.auf }
      : { family: t.family, origin: "solve-step", solveId: t.origin.solveId, stepName: t.origin.stepName,
        trainingSet: "full", caseId: t.caseId, auf: t.auf };
  }
  return { id: crypto.randomUUID(), createdAt: Date.now(), mode, target, moves: [...result.moves],
    stm: result.stm, elapsedMs: result.elapsedMs, recommendedStm: result.recommendedStm,
    matchedReferenceRank: result.matchedReferenceRank, delta: result.delta };
}

export async function loadTrainingAttempts(): Promise<TrainingAttempt[]> { return db.loadTrainingAttempts(); }
export async function saveTrainingAttempt(attempt: TrainingAttempt): Promise<void> { await db.saveTrainingAttempt(attempt); }
