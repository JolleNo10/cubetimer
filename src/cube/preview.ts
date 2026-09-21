import { Alg } from "cubing/alg";
import { patternToFacelets, SOLVED_FACELETS } from "./facelets";
import { get3x3x3 } from "./puzzle";
import type { KPuzzle } from "cubing/kpuzzle";

let kpuzzle: KPuzzle | null = null;
void get3x3x3().then((loaded) => (kpuzzle = loaded));

/** Facelets of a solved 3x3x3 with `scramble` applied, for the flat preview. */
export function previewFacelets(scramble: string): string {
  if (!kpuzzle || !scramble) return SOLVED_FACELETS;
  try {
    return patternToFacelets(kpuzzle.defaultPattern().applyAlg(new Alg(scramble)));
  } catch {
    return SOLVED_FACELETS;
  }
}
