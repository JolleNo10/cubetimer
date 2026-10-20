import type { KPattern } from "cubing/kpuzzle";
import type { F2lTrainingTargetInfo } from "./f2lTraining";
import type { LastLayerTrainingTargetInfo } from "./lastLayerTraining";
import { CORNER_FACELETS, EDGE_FACELETS, CENTER_FACELETS, SOLVED_FACELETS } from "./facelets";
import { CORNER_NAMES, EDGE_NAMES, OPPOSITE, FACES } from "./moves";

export type TrainingFocusTarget = F2lTrainingTargetInfo | LastLayerTrainingTargetInfo;
type Sticker = "regular" | "ignored";
export type TrainingStickerMask = { orbits: Record<string, { pieces: { facelets: Sticker[] }[] }> };

/** Masks belong to piece identities, so they follow turns without changing cube state. */
export function trainingFocusMask(target: TrainingFocusTarget): TrainingStickerMask | undefined {
  if (target.family === "pll") return undefined;
  const top = FACES.find(face => target.trainingRotation.orientation[face] === "U")!;
  const piece = (indexes: readonly number[], index: number, corner: boolean): { facelets: Sticker[] } => ({
    // Twisty also queries auxiliary facelets (e.g. oriented centres); provide
    // the same five-slot padding used by its built-in masks.
    facelets: Array.from({ length: 5 }, (_, sticker) => {
      const facelet = indexes[sticker];
      if (facelet === undefined) return "ignored";
      if (target.family === "f2l") {
        return (corner ? CORNER_NAMES[index].includes(target.crossFace) : !EDGE_NAMES[index].includes(OPPOSITE[target.crossFace])) ? "regular" : "ignored";
      }
      return (!corner || target.completionGoal !== "orient-edges") && SOLVED_FACELETS[facelet] === top ? "regular" : "ignored";
    }),
  });
  return { orbits: {
    CORNERS: { pieces: CORNER_FACELETS.map((f, i) => piece(f, i, true)) },
    EDGES: { pieces: EDGE_FACELETS.map((f, i) => piece(f, i, false)) },
    CENTERS: { pieces: CENTER_FACELETS.map(i => ({ facelets: Array<Sticker>(5).fill(target.family === "f2l" || SOLVED_FACELETS[i] === top ? "regular" : "ignored") })) },
  } };
}

/** The same identity mask projected onto current facelets for the 2D renderer. */
export function trainingFocusFacelets(pattern: KPattern, mask: TrainingStickerMask): boolean[] {
  const visible = Array<boolean>(54).fill(true);
  for (const [orbit, slots] of [["CORNERS", CORNER_FACELETS], ["EDGES", EDGE_FACELETS], ["CENTERS", CENTER_FACELETS.map(i => [i])]] as const) {
    const data = pattern.patternData[orbit];
    slots.forEach((indexes, slot) => {
      indexes.forEach((_, sticker) => {
        visible[indexes[(sticker + data.orientation[slot]) % indexes.length]] =
          mask.orbits[orbit].pieces[data.pieces[slot]].facelets[sticker] !== "ignored";
      });
    });
  }
  return visible;
}
