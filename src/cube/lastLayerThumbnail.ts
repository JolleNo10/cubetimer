import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import { patternToFacelets } from "./facelets";
import type { LastLayerCompletionGoal, LastLayerFamily } from "./lastLayerTraining";
import { FACE_OFFSET, type Face } from "./moves";
import type { Rotation } from "./orientation";

export type LastLayerStickerPresentation = Face | "grey";

export type LastLayerThumbnailModel = {
  family: LastLayerFamily;
  /** Row-major U face, physically turned into the Training display grip. */
  top: readonly LastLayerStickerPresentation[];
  /** Side stickers are already ordered for the top-down diagram. */
  back: readonly LastLayerStickerPresentation[];
  right: readonly LastLayerStickerPresentation[];
  front: readonly LastLayerStickerPresentation[];
  left: readonly LastLayerStickerPresentation[];
};

export function getLastLayerThumbnailModel(
  family: LastLayerFamily,
  pattern: KPattern,
  trainingRotation: Pick<Rotation, "tokens">,
  completionGoal: LastLayerCompletionGoal = family === "oll" ? "orient-last-layer" : "solve-cube",
): LastLayerThumbnailModel {
  // A solver-frame reframe leaves sticker colours in cube coordinates. Display
  // rotation must physically move them into the selected Training grip instead.
  const displayedPattern = pattern.applyAlg(new Alg(trainingRotation.tokens.join(" ")));
  const facelets = patternToFacelets(displayedPattern);
  const topColour = facelets[FACE_OFFSET.U + 4];
  const stickers = (face: Face, indexes: readonly number[]): LastLayerStickerPresentation[] =>
    indexes.map((index) => {
      // Stage focus belongs to the domain model, shared by every renderer.
      if (completionGoal === "orient-edges" && (face === "U" ? [0, 2, 6, 8].includes(index) : index !== 1)) return "grey";
      if (completionGoal === "permute-corners" && face !== "U" && index === 1) return "grey";
      const colour = facelets[FACE_OFFSET[face] + index] as Face;
      return family === "pll" || colour === topColour ? colour : "grey";
    });

  return {
    family,
    top: stickers("U", [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    back: stickers("B", [2, 1, 0]),
    right: stickers("R", [2, 1, 0]),
    front: stickers("F", [0, 1, 2]),
    left: stickers("L", [0, 1, 2]),
  };
}
