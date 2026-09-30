import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import {
  CENTER_FACELETS,
  CORNER_FACELETS,
  EDGE_FACELETS,
  patternToFacelets,
} from "./facelets";
import { F2L_CASES, type F2lCase, type F2lPosition } from "./f2lCases";
import { buildStandardF2lCaseState } from "./f2lTraining";
import { EDGES_OF_FACE, f2lSlotsForCrossFace } from "./moves";

export type F2lThumbnailModel = {
  facelets: string;
  emphasized: readonly boolean[];
};

const CROSS_FACE = "U" as const;

function addPair(
  pattern: KPattern,
  slot: { corner: number; edge: number },
  cornerPieces: Set<number>,
  edgePieces: Set<number>,
): void {
  cornerPieces.add(pattern.patternData.CORNERS.pieces[slot.corner]);
  edgePieces.add(pattern.patternData.EDGES.pieces[slot.edge]);
}

function isSolvedSlot(
  pattern: KPattern,
  slot: { corner: number; edge: number },
): boolean {
  const { CORNERS, EDGES } = pattern.patternData;
  return (
    CORNERS.pieces[slot.corner] === slot.corner &&
    CORNERS.orientation[slot.corner] === 0 &&
    EDGES.pieces[slot.edge] === slot.edge &&
    EDGES.orientation[slot.edge] === 0
  );
}

/** Build the canonical, physically oriented teaching diagram for one F2L case. */
export function buildF2lThumbnailModel(
  kpuzzle: KPuzzle,
  f2lCase: F2lCase,
  position: F2lPosition,
): F2lThumbnailModel {
  const { pattern, trainingRotation, slot: targetSlot } = buildStandardF2lCaseState(
    kpuzzle,
    f2lCase,
    position,
  );
  const slots = f2lSlotsForCrossFace(CROSS_FACE);
  const target = slots.find((candidate) => candidate.name === targetSlot);
  if (!target) throw new Error(`Unknown F2L slot ${targetSlot} for ${f2lCase.name}`);

  const emphasizedCorners = new Set<number>();
  const emphasizedEdges = new Set<number>();
  addPair(pattern, target, emphasizedCorners, emphasizedEdges);

  const edges = pattern.patternData.EDGES;
  for (const edge of EDGES_OF_FACE[CROSS_FACE]) {
    if (edges.pieces[edge] === edge && edges.orientation[edge] === 0) {
      emphasizedEdges.add(edges.pieces[edge]);
    }
  }

  for (const candidate of slots) {
    if (candidate.name !== targetSlot && isSolvedSlot(pattern, candidate)) {
      addPair(pattern, candidate, emphasizedCorners, emphasizedEdges);
    }
  }

  const rotationAlg = new Alg(trainingRotation.tokens.join(" "));
  const displayPattern = pattern.applyAlg(rotationAlg);
  const facelets = patternToFacelets(displayPattern);
  const emphasized = new Array<boolean>(54).fill(false);

  for (const index of CENTER_FACELETS) emphasized[index] = true;

  const displayCorners = displayPattern.patternData.CORNERS.pieces;
  for (let slotIndex = 0; slotIndex < displayCorners.length; slotIndex++) {
    if (!emphasizedCorners.has(displayCorners[slotIndex])) continue;
    for (const index of CORNER_FACELETS[slotIndex]) emphasized[index] = true;
  }

  const displayEdges = displayPattern.patternData.EDGES.pieces;
  for (let slotIndex = 0; slotIndex < displayEdges.length; slotIndex++) {
    if (!emphasizedEdges.has(displayEdges[slotIndex])) continue;
    for (const index of EDGE_FACELETS[slotIndex]) emphasized[index] = true;
  }

  return { facelets, emphasized };
}

export function buildAllF2lThumbnailModels(
  kpuzzle: KPuzzle,
  position: F2lPosition,
): ReadonlyMap<string, F2lThumbnailModel> {
  return new Map(
    F2L_CASES.map((f2lCase) => [
      f2lCase.name,
      buildF2lThumbnailModel(kpuzzle, f2lCase, position),
    ]),
  );
}
