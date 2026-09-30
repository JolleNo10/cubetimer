import type { F2lPosition } from "./f2lCases";
import { F2L_THUMBNAIL_MAP } from "./f2lThumbnailMap.generated";
import { ADVANCED_F2L_THUMBNAIL_MAP } from "./advancedF2lThumbnailMap.generated";
import type { F2lTrainingLibrary } from "./f2lTrainingCases";

export type F2lThumbnailModel = {
  facelets: string;
  emphasized: readonly boolean[];
};

/** Adapt the checked-in canonical case diagram to the SVG renderer's mask. */
export function getF2lThumbnailModel(library: F2lTrainingLibrary, caseName: string, position: F2lPosition): F2lThumbnailModel {
  const map = library === "basic" ? F2L_THUMBNAIL_MAP : ADVANCED_F2L_THUMBNAIL_MAP;
  const stored = map[caseName]?.[position];
  if (!stored) throw new Error(`Missing F2L thumbnail ${caseName} ${position} in ${library}`);
  const emphasized = new Array<boolean>(54).fill(false);
  for (const index of stored.emphasized) emphasized[index] = true;
  return { facelets: stored.facelets, emphasized };
}
