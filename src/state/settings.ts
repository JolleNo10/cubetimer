import { faceOfColour, FACE_COLOURS } from "../cube/colours";
import { frontsFor } from "../cube/orientation";
import type { Settings } from "./types";

/**
 * Keep a settings change self-consistent.
 *
 * The two grip colours are not independent: nothing can be both underneath and facing
 * you, and nothing can face you if its opposite is underneath. Changing the bottom can
 * therefore invalidate the front, which is put right rather than left broken.
 */
export function normaliseSettings(settings: Settings): Settings {
  const bottom = faceOfColour(settings.crossColour);
  if (!bottom) return settings;
  const fronts = frontsFor(bottom);
  const front = faceOfColour(settings.frontColour);
  if (front && fronts.includes(front)) return settings;
  return { ...settings, frontColour: FACE_COLOURS[fronts[0]].name };
}
