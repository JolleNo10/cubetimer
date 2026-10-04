import type { TrainingAttempt } from "../../app/types";
import type { F2lPosition } from "../../cube/f2lCases";
import { f2lTrainingCatalogue, type F2lTrainingLibrary, type F2lTrainingCase } from "../../cube/f2lTrainingCases";
import { lastLayerCaseCatalogue, type LastLayerTrainingSet } from "../../cube/lastLayerTraining";
import { EMPTY_TRAINING_CASE_STATS, trainingCaseKey, trainingStatsByCase, trainingTimingRatio, type TrainingCaseStats, type TrainingCatalogueCase } from "./trainingPerformance";

export type TrainingDrillStrategy = "sequence" | "random" | "weighted";
export type TrainingDrillContext =
  | { family: "f2l"; library: F2lTrainingLibrary; position: F2lPosition }
  | { family: "oll" | "pll"; trainingSet: LastLayerTrainingSet };
export type TrainingDrillState = {
  strategy: TrainingDrillStrategy;
  selectedCaseIds: string[];
  running: boolean;
  round: number;
  context: TrainingDrillContext | null;
  lastCaseId: string | null;
  lastOutcome: "solved" | "skipped" | null;
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

export function drillCaseWeight(stats: TrainingCaseStats): number {
  const base = { practiced: 1, learning: 3, new: 4, review: 6 }[stats.status];
  const delta = stats.recentMedianDelta;
  const ratio = trainingTimingRatio(stats);
  return base + (delta !== null && delta > 0 ? Math.min(4, delta) : 0) +
    (ratio !== null && ratio > 1 ? Math.min(4, (ratio - 1) * 5) : 0);
}

/** Pure draw over the selected pool; no target construction, clocks or persistence. */
export function selectDrillCase(
  cases: readonly TrainingCatalogueCase[], strategy: TrainingDrillStrategy,
  round: number, previousCaseId: string | null, attempts: readonly TrainingAttempt[],
  rng: () => number = Math.random,
): TrainingCatalogueCase | null {
  if (!cases.length) return null;
  if (strategy === "sequence") return cases[round % cases.length];
  const pool = cases.length > 1 ? cases.filter(c => drillCaseId(c) !== previousCaseId) : cases;
  const stats = strategy === "weighted" ? trainingStatsByCase(attempts) : null;
  const weights = pool.map(c => stats ? drillCaseWeight(stats.get(trainingCaseKey(c)!) ?? EMPTY_TRAINING_CASE_STATS) : 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let draw = Math.max(0, Math.min(1, rng())) * total;
  for (let i = 0; i < pool.length; i++) {
    draw -= weights[i];
    if (draw < 0) return pool[i];
  }
  return pool.at(-1)!;
}
