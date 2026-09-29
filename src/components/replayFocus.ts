import type { SolveAnalysis, SolveStep } from "../cube/analysis";
import { f2lSlotsForCrossFace } from "../cube/moves";

export const NORMAL_REPLAY_STICKERING_MASK =
  "EDGES:------------,CORNERS:--------,CENTERS:------";

function slotForStep(
  analysis: SolveAnalysis,
  step: SolveStep | undefined,
): { corner: number; edge: number; name: string } | undefined {
  if (!step || step.skipped || !step.name.startsWith("F2L") || !step.slot) {
    return undefined;
  }

  return f2lSlotsForCrossFace(analysis.crossFace).find(
    (candidate) => candidate.name === step.slot,
  );
}

/** Return the replay mask for the current F2L pair and its next lookahead pair. */
export function replayStickeringMask(
  analysis: SolveAnalysis,
  activeStepIndex: number,
): string {
  const currentSlot = slotForStep(analysis, analysis.steps[activeStepIndex]);
  if (!currentSlot) return NORMAL_REPLAY_STICKERING_MASK;

  const nextSlot = analysis.steps
    .slice(activeStepIndex + 1)
    .map((step) => slotForStep(analysis, step))
    .find((slot) => slot !== undefined);

  const edges = Array.from({ length: 12 }, () => "I");
  const corners = Array.from({ length: 8 }, () => "I");
  if (nextSlot) {
    edges[nextSlot.edge] = "D";
    corners[nextSlot.corner] = "D";
  }
  edges[currentSlot.edge] = "-";
  corners[currentSlot.corner] = "-";

  return [
    `EDGES:${edges.join("")}`,
    `CORNERS:${corners.join("")}`,
    "CENTERS:IIIIII",
  ].join(",");
}
