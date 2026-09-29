import type { SolveAnalysis, SolveStep } from "../cube/analysis";
import { f2lSlotsForCrossFace } from "../cube/moves";

export const NORMAL_REPLAY_STICKERING_MASK =
  "EDGES:------------,CORNERS:--------,CENTERS:------";

/** Return the replay mask for the F2L pair belonging to the current step. */
export function replayStickeringMask(
  analysis: SolveAnalysis,
  step: SolveStep | undefined,
): string {
  if (!step || !step.name.startsWith("F2L") || !step.slot) {
    return NORMAL_REPLAY_STICKERING_MASK;
  }

  const slot = f2lSlotsForCrossFace(analysis.crossFace).find(
    (candidate) => candidate.name === step.slot,
  );
  if (!slot) return NORMAL_REPLAY_STICKERING_MASK;

  const edges = Array.from({ length: 12 }, () => "D");
  const corners = Array.from({ length: 8 }, () => "D");
  edges[slot.edge] = "-";
  corners[slot.corner] = "-";

  return [
    `EDGES:${edges.join("")}`,
    `CORNERS:${corners.join("")}`,
    "CENTERS:DDDDDD",
  ].join(",");
}
