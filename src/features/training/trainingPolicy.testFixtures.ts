import type { TrainingAttempt, TrainingCatalogueIdentity, TrainingDrillPresetContext, TrainingRecognitionAttempt } from "../../app/types";
import { trainingCatalogueCaseId } from "../../app/trainingCatalogue";
import { drillCatalogue } from "./trainingDrill";

export const policyContext: TrainingDrillPresetContext = { family: "pll", trainingSet: "full" };
export const policyTargets = drillCatalogue(policyContext);
export const DAY = 86400000;
export function executionEvidence(target: TrainingCatalogueIdentity = policyTargets[0], count = 5,
  overrides: Partial<TrainingAttempt> = {}, start = 0, span = 0): TrainingAttempt[] {
  return Array.from({ length: count }, (_, i) => ({ id: `e-${trainingCatalogueCaseId(target)}-${i}`, createdAt: start + (count > 1 ? span * i / (count - 1) : 0),
    target: target.family === "f2l" ? { ...target, origin: "catalog" } : { ...target, origin: "catalog", auf: i % 4 as 0 | 1 | 2 | 3 },
    activity: "drill", mode: "virtual", drillRunId: "execution", drillRound: i + 1, caseTimeMs: 1000, elapsedMs: 500,
    moves: ["R"], stm: 8, recommendedStm: 8, matchedReferenceRank: 1, delta: 0,
    preferredStm: null, preferredDelta: null, matchedPreferred: null, ...overrides }));
}
export function recognitionEvidence(target: TrainingCatalogueIdentity = policyTargets[0], count = 5,
  overrides: Partial<TrainingRecognitionAttempt> = {}, start = 0, span = 0): TrainingRecognitionAttempt[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r-${trainingCatalogueCaseId(target)}-${i}`, createdAt: start + (count > 1 ? span * i / (count - 1) : 0),
    target, drillRunId: "recognition", drillRound: i + 1, responseMs: 1000, answerCaseId: trainingCatalogueCaseId(target), ...overrides }));
}
