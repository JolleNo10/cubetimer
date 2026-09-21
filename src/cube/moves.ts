/** Face turn helpers shared by the cube model, scramble tracker and analyser. */

export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];

export const OPPOSITE: Record<Face, Face> = {
  U: "D",
  D: "U",
  R: "L",
  L: "R",
  F: "B",
  B: "F",
};

/** cubing.js EDGES orbit order. */
export const EDGE_NAMES = [
  "UF", "UR", "UB", "UL",
  "DF", "DR", "DB", "DL",
  "FR", "FL", "BR", "BL",
] as const;

/** cubing.js CORNERS orbit order. */
export const CORNER_NAMES = [
  "URF", "UBR", "ULB", "UFL",
  "DFR", "DLF", "DBL", "DRB",
] as const;

/** Facelet index range of each face within a Kociemba facelet string. */
export const FACE_OFFSET: Record<Face, number> = {
  U: 0,
  R: 9,
  F: 18,
  D: 27,
  L: 36,
  B: 45,
};

export const EDGES_OF_FACE: Record<Face, number[]> = Object.fromEntries(
  FACES.map((f) => [f, indicesContaining(EDGE_NAMES, f)]),
) as Record<Face, number[]>;

export const CORNERS_OF_FACE: Record<Face, number[]> = Object.fromEntries(
  FACES.map((f) => [f, indicesContaining(CORNER_NAMES, f)]),
) as Record<Face, number[]>;

function indicesContaining(names: readonly string[], face: string): number[] {
  return names.flatMap((n, i) => (n.includes(face) ? [i] : []));
}

/** The four F2L slots (corner + edge) belonging to a given cross face. */
export function f2lSlotsForCrossFace(
  cross: Face,
): { corner: number; edge: number; name: string }[] {
  return CORNERS_OF_FACE[cross].map((corner) => {
    const sides = CORNER_NAMES[corner]
      .split("")
      .filter((f) => f !== cross);
    const edge = EDGE_NAMES.findIndex(
      (n) => sides.every((f) => n.includes(f)),
    );
    // Name the slot after its edge ("FR", "BL", …) so it reads the same way solvers do.
    return { corner, edge, name: EDGE_NAMES[edge] as string };
  });
}

/**
 * Parse `"R'"`, `"U2"`, `"F"` or `"B2'"` into its face and quarter-turn count.
 * Inverted algs from cubing.js are written with a trailing `2'`, so that form has to
 * be understood as well as the plain `2`.
 */
export function parseFaceMove(
  move: string,
): { face: Face; amount: number } | null {
  const m = /^([URFDLB])(2'?|')?$/.exec(move.trim());
  if (!m) return null;
  const suffix = m[2] ?? "";
  return {
    face: m[1] as Face,
    amount: suffix === "'" ? -1 : suffix.startsWith("2") ? 2 : 1,
  };
}
