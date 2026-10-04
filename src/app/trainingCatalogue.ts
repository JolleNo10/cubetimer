import type { TrainingCatalogueIdentity } from "./types";
import { F2L_POSITIONS } from "../cube/f2lCases";
import { findF2lTrainingCase } from "../cube/f2lTrainingCases";
import { lastLayerCaseIds, type LastLayerTrainingTargetInfo } from "../cube/lastLayerTraining";
import type { F2lTrainingTargetInfo } from "../cube/f2lTraining";

export function trainingCatalogueKey(identity: TrainingCatalogueIdentity): string {
  return JSON.stringify(identity.family === "f2l"
    ? [identity.family, identity.library, identity.caseName, identity.position]
    : [identity.family, identity.trainingSet, identity.caseId]);
}

export function catalogueIdentityForTarget(target: F2lTrainingTargetInfo | LastLayerTrainingTargetInfo | null): TrainingCatalogueIdentity | null {
  if (!target || target.origin.kind !== "catalog") return null;
  return target.family === "f2l"
    ? { family: "f2l", library: target.origin.library, caseName: target.origin.caseName, position: target.position }
    : { family: target.family, trainingSet: target.trainingSet, caseId: target.caseId };
}

/** Rebuild only current, valid catalogue identity; infrastructure does no solving. */
export function normalizeTrainingCatalogueIdentity(value: unknown): TrainingCatalogueIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.family === "f2l") {
    const position = F2L_POSITIONS.find(p => p === v.position);
    if (!position || (v.library !== "basic" && v.library !== "advanced") || typeof v.caseName !== "string" ||
        !findF2lTrainingCase(v.library, v.caseName) || "trainingSet" in v || "caseId" in v) return null;
    return { family: "f2l", library: v.library, caseName: v.caseName, position };
  }
  if (v.family !== "oll" && v.family !== "pll") return null;
  if ((v.trainingSet !== "full" && v.trainingSet !== "2look") || typeof v.caseId !== "string" ||
      !lastLayerCaseIds(v.family, v.trainingSet).includes(v.caseId) || "library" in v || "position" in v || "caseName" in v) return null;
  return { family: v.family, trainingSet: v.trainingSet, caseId: v.caseId };
}
