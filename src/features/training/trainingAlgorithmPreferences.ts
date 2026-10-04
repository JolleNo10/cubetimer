import { normalizeTrainingReferenceAlgorithm, TRAINING_AUFS } from "../../cube/training";
import type { KPuzzle } from "cubing/kpuzzle";
import type { TrainingAlgorithmPreference, TrainingCatalogueIdentity } from "../../app/types";
import { normalizeTrainingCatalogueIdentity, trainingCatalogueKey } from "../../app/trainingCatalogue";
import { buildF2lCatalogueTarget, resolveF2lTrainingReference } from "../../cube/f2lTraining";
import { findF2lTrainingCase } from "../../cube/f2lTrainingCases";
import { buildLastLayerCatalogueTarget, lastLayerTrainingVariants, resolveLastLayerTrainingReference } from "../../cube/lastLayerTraining";
import * as db from "../../infrastructure/persistence/db";

export function normalizePersonalAlgorithm(input: string): string {
  if (!input.trim() || input.length > 1000) throw new Error("Enter an algorithm between 1 and 1000 characters.");
  const normalized = normalizeTrainingReferenceAlgorithm(input);
  if (!normalized) throw new Error("Use valid cube notation with at most 1000 expanded moves.");
  return normalized;
}

/** Explicit save/import validation, never a frame/move-time all-variant check. */
export function validateTrainingAlgorithm(kpuzzle: KPuzzle, identity: TrainingCatalogueIdentity, algorithm: string): string {
  const target = normalizeTrainingCatalogueIdentity(identity);
  if (!target) throw new Error("This is not a valid Training catalogue case.");
  const normalized = normalizePersonalAlgorithm(algorithm);
  if (target.family === "f2l") {
    for (const auf of TRAINING_AUFS) {
      const built = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase(target.library, target.caseName)!, target.position, undefined, auf);
      if (!resolveF2lTrainingReference(built, normalized)) throw new Error("This algorithm does not complete every selected F2L variation and preserve its protected slots.");
    }
  } else {
    for (const variant of lastLayerTrainingVariants(kpuzzle, target.family, target.caseId, target.trainingSet)) {
      for (const auf of [0, 1, 2, 3] as const) {
        const built = buildLastLayerCatalogueTarget(kpuzzle, target.family, target.caseId, auf, target.trainingSet, variant.id);
        if (!resolveLastLayerTrainingReference(built, normalized))
          throw new Error("This algorithm must complete the case for every Training variant and AUF.");
      }
    }
  }
  return normalized;
}

export function createTrainingAlgorithmPreference(
  kpuzzle: KPuzzle, target: TrainingCatalogueIdentity, algorithm: string,
  source: TrainingAlgorithmPreference["source"], note: string | null = null,
  previous: TrainingAlgorithmPreference | null = null,
): TrainingAlgorithmPreference {
  const normalized = validateTrainingAlgorithm(kpuzzle, target, algorithm);
  const trimmedNote = note?.trim() || null;
  if (trimmedNote && trimmedNote.length > 240) throw new Error("Keep the note within 240 characters.");
  const key = trainingCatalogueKey(target), now = Date.now();
  const preference = db.normalizeTrainingAlgorithmPreference({ key, target, algorithm: normalized,
    source: source === "custom" && previous?.source === "catalog" && previous.algorithm === normalized ? "catalog" : source,
    note: trimmedNote,
    createdAt: previous?.key === key ? previous.createdAt : now, updatedAt: now });
  if (!preference) throw new Error("Invalid personal Training algorithm record.");
  return preference;
}

export function loadTrainingAlgorithmPreferences() { return db.loadTrainingAlgorithmPreferences(); }
export function saveTrainingAlgorithmPreference(preference: TrainingAlgorithmPreference) { return db.saveTrainingAlgorithmPreference(preference); }
export function deleteTrainingAlgorithmPreference(key: string) { return db.deleteTrainingAlgorithmPreference(key); }
