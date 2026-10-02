import type { KPattern } from "cubing/kpuzzle";
import { patternToFacelets } from "./facelets";
import type { LastLayerFamily } from "./lastLayerTraining";

export type LastLayerThumbnailModel = {
  family: LastLayerFamily;
  facelets: string;
  /** Facelet indexes that belong to the visible last-layer recognition view. */
  visible: readonly number[];
};

const OFFSETS = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 } as const;

export function getLastLayerThumbnailModel(
  family: LastLayerFamily,
  pattern: KPattern,
): LastLayerThumbnailModel {
  const visible = [
    ...Array.from({ length: 9 }, (_, index) => index),
    ...(["F", "R", "B", "L"] as const).flatMap((face) =>
      [0, 1, 2].map((index) => OFFSETS[face] + index),
    ),
  ];
  return { family, facelets: patternToFacelets(pattern), visible };
}
