/**
 * What the faces actually look like.
 *
 * Face letters are how a cube is described; colours are how a cuber talks. "Cross on
 * white" and "the green-red slot" mean something at a glance where "cross on U" and
 * "the FR slot" need translating first.
 *
 * The scheme is the standard Western one — white opposite yellow, green opposite blue,
 * red opposite orange, with white on top and green in front — which is also the
 * orientation WCA scrambles are applied in.
 */
import { FACES, type Face } from "./moves";

export type FaceColour = {
  name: string;
  hex: string;
};

export const FACE_COLOURS: Record<Face, FaceColour> = {
  U: { name: "white", hex: "#f2f4f8" },
  R: { name: "red", hex: "#e5484d" },
  F: { name: "green", hex: "#30a46c" },
  D: { name: "yellow", hex: "#ffd400" },
  L: { name: "orange", hex: "#ff8b3d" },
  B: { name: "blue", hex: "#3b82f6" },
};

export function faceColour(face: Face): FaceColour {
  return FACE_COLOURS[face];
}

/** The face wearing a colour, e.g. `"white"` → `"U"`. */
export function faceOfColour(name: string): Face | null {
  return FACES.find((face) => FACE_COLOURS[face].name === name) ?? null;
}

/**
 * Name an F2L slot by the two colours that meet there: `"FR"` becomes
 * `"green-red"`, which is what a solver would call it.
 */
export function slotColours(slot: string): string | null {
  const faces = slot.split("") as Face[];
  if (faces.length !== 2 || faces.some((face) => !FACE_COLOURS[face])) return null;
  return faces.map((face) => FACE_COLOURS[face].name).join("-");
}

export { FACES };
export type { Face };
