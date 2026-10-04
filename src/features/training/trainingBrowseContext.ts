import type { TrainingAttempt, TrainingCatalogueIdentity, TrainingDrillPresetContext, TrainingRecognitionAttempt } from "../../app/types";
import { drillCatalogue } from "./trainingDrill";

export function trainingContextMatches(target: TrainingCatalogueIdentity, context: TrainingDrillPresetContext): boolean {
  return target.family === "f2l" && context.family === "f2l" ? target.library === context.library && target.position === context.position :
    target.family !== "f2l" && context.family !== "f2l" && target.family === context.family && target.trainingSet === context.trainingSet;
}

/** Narrow every surface before aggregation/windowing; exact facts have no catalogue context. */
export function trainingContextHistory(execution: readonly TrainingAttempt[], recognition: readonly TrainingRecognitionAttempt[],
  context: TrainingDrillPresetContext | null) {
  return { execution: context ? execution.filter(a => a.target.origin === "catalog" && trainingContextMatches(a.target, context)) : execution,
    recognition: context ? recognition.filter(a => trainingContextMatches(a.target, context)) : recognition,
    catalogue: context ? drillCatalogue(context) : null };
}
