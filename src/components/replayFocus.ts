import type { SolveAnalysis, SolveStep } from "../cube/analysis";
import {
  CORNER_NAMES,
  EDGES_OF_FACE,
  EDGE_NAMES,
  OPPOSITE,
  f2lSlotsForCrossFace,
} from "../cube/moves";

export const NORMAL_REPLAY_STICKERING_MASK =
  "EDGES:------------,CORNERS:--------,CENTERS:------";

type F2lSlot = ReturnType<typeof f2lSlotsForCrossFace>[number];

const CENTRE_NAMES = ["U", "L", "F", "R", "B", "D"] as const;

function resolvedF2lSlot(
  analysis: SolveAnalysis,
  step: SolveStep | undefined,
): F2lSlot | undefined {
  if (!step || !step.name.startsWith("F2L") || !step.slot) {
    return undefined;
  }

  return f2lSlotsForCrossFace(analysis.crossFace).find(
    (candidate) => candidate.name === step.slot,
  );
}

function lastLayerMask(analysis: SolveAnalysis): string {
  const lastLayerFace = OPPOSITE[analysis.crossFace];
  const edges = EDGE_NAMES.map((name) => name.includes(lastLayerFace) ? "-" : "D");
  const corners = CORNER_NAMES.map((name) => name.includes(lastLayerFace) ? "-" : "D");
  const centers = CENTRE_NAMES.map((face) => face === lastLayerFace ? "-" : "D");

  return [
    `EDGES:${edges.join("")}`,
    `CORNERS:${corners.join("")}`,
    `CENTERS:${centers.join("")}`,
  ].join(",");
}

function f2lFocusMask(
  analysis: SolveAnalysis,
  activeStepIndex: number,
  currentSlot: F2lSlot,
): string {
  const edges = Array.from({ length: 12 }, () => "I");
  const corners = Array.from({ length: 8 }, () => "I");

  for (const edge of EDGES_OF_FACE[analysis.crossFace]) {
    edges[edge] = "D";
  }

  for (const step of analysis.steps.slice(0, activeStepIndex)) {
    const slot = resolvedF2lSlot(analysis, step);
    if (slot) {
      edges[slot.edge] = "D";
      corners[slot.corner] = "D";
    }
  }

  const nextSlot = analysis.steps
    .slice(activeStepIndex + 1)
    .find((step) => !step.skipped && resolvedF2lSlot(analysis, step));
  const resolvedNextSlot = nextSlot
    ? resolvedF2lSlot(analysis, nextSlot)
    : undefined;
  if (resolvedNextSlot) {
    edges[resolvedNextSlot.edge] = "o";
    corners[resolvedNextSlot.corner] = "o";
  }

  edges[currentSlot.edge] = "-";
  corners[currentSlot.corner] = "-";

  return [
    `EDGES:${edges.join("")}`,
    `CORNERS:${corners.join("")}`,
    "CENTERS:DDDDDD",
  ].join(",");
}

/** Return the replay mask for the current phase's relevant cubies. */
export function replayStickeringMask(
  analysis: SolveAnalysis,
  activeStepIndex: number,
): string {
  const step = analysis.steps[activeStepIndex];
  if (!step) return NORMAL_REPLAY_STICKERING_MASK;

  if (step.name.startsWith("F2L")) {
    const currentSlot = resolvedF2lSlot(analysis, step);
    return currentSlot
      ? f2lFocusMask(analysis, activeStepIndex, currentSlot)
      : NORMAL_REPLAY_STICKERING_MASK;
  }

  if (step.name === "OLL" || step.name === "PLL") {
    return lastLayerMask(analysis);
  }

  return NORMAL_REPLAY_STICKERING_MASK;
}
