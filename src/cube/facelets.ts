/**
 * Conversion between the Kociemba 54-character facelet string used by smart cube
 * firmware (and by most solvers) and the `KPattern` representation used by cubing.js.
 *
 * Facelet string layout is `U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9`, each face read
 * left-to-right, top-to-bottom while looking straight at it with U on top (B is read
 * with U on top as well).
 *
 * cubing.js orbit orders (derived from the 3x3x3 KPuzzle move definitions):
 *   CORNERS: URF UBR ULB UFL DFR DLF DBL DRB
 *   EDGES:   UF UR UB UL DF DR DB DL FR FL BR BL
 *   CENTERS: U L F R B D
 */
import { KPattern } from "cubing/kpuzzle";
import type { KPuzzle } from "cubing/kpuzzle";

export const SOLVED_FACELETS =
  "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

/** Facelet indices per corner slot, U/D sticker first then clockwise (viewed from outside). */
const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20], // URF
  [2, 45, 11], // UBR
  [0, 36, 47], // ULB
  [6, 18, 38], // UFL
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];

/** Facelet indices per edge slot, orientation-reference sticker (U/D, else F/B) first. */
const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [7, 19], // UF
  [5, 10], // UR
  [1, 46], // UB
  [3, 37], // UL
  [28, 25], // DF
  [32, 16], // DR
  [34, 52], // DB
  [30, 43], // DL
  [23, 12], // FR
  [21, 41], // FL
  [48, 14], // BR
  [50, 39], // BL
];

/** Facelet index of each center, in cubing.js CENTERS order (U L F R B D). */
const CENTER_FACELETS: readonly number[] = [4, 40, 22, 13, 49, 31];

/** Face letter of each center slot, in cubing.js CENTERS order. */
const CENTER_COLORS = ["U", "L", "F", "R", "B", "D"] as const;

/** Sticker colours of each corner piece at home, same order as `CORNER_FACELETS`. */
const CORNER_COLORS = CORNER_FACELETS.map(
  (f) => f.map((i) => SOLVED_FACELETS[i]) as [string, string, string],
);

/** Sticker colours of each edge piece at home, same order as `EDGE_FACELETS`. */
const EDGE_COLORS = EDGE_FACELETS.map(
  (f) => f.map((i) => SOLVED_FACELETS[i]) as [string, string],
);

export class InvalidFaceletsError extends Error {}

/** Render a `KPattern` as a Kociemba facelet string. */
export function patternToFacelets(pattern: KPattern): string {
  const out = new Array<string>(54).fill(".");
  const data = pattern.patternData;

  const corners = data.CORNERS;
  for (let slot = 0; slot < 8; slot++) {
    const piece = corners.pieces[slot];
    const twist = corners.orientation[slot];
    for (let k = 0; k < 3; k++) {
      out[CORNER_FACELETS[slot][(k + twist) % 3]] = CORNER_COLORS[piece][k];
    }
  }

  const edges = data.EDGES;
  for (let slot = 0; slot < 12; slot++) {
    const piece = edges.pieces[slot];
    const flip = edges.orientation[slot];
    out[EDGE_FACELETS[slot][flip]] = EDGE_COLORS[piece][0];
    out[EDGE_FACELETS[slot][1 - flip]] = EDGE_COLORS[piece][1];
  }

  const centers = data.CENTERS;
  for (let slot = 0; slot < 6; slot++) {
    out[CENTER_FACELETS[slot]] = CENTER_COLORS[centers.pieces[slot]];
  }

  return out.join("");
}

/**
 * Parse a Kociemba facelet string into a `KPattern`.
 * Centers are assumed to be in the standard orientation, which is what smart cubes report.
 *
 * @throws {InvalidFaceletsError} if a piece cannot be identified (misread sticker, wrong length).
 */
export function faceletsToPattern(kpuzzle: KPuzzle, facelets: string): KPattern {
  if (facelets.length !== 54) {
    throw new InvalidFaceletsError(
      `Expected 54 facelets, received ${facelets.length}`,
    );
  }

  const cornerPieces = new Array<number>(8).fill(0);
  const cornerOrientation = new Array<number>(8).fill(0);
  for (let slot = 0; slot < 8; slot++) {
    const stickers = CORNER_FACELETS[slot].map((i) => facelets[i]);
    const found = findCubie(CORNER_COLORS, stickers);
    if (!found) {
      throw new InvalidFaceletsError(
        `Unrecognised corner at slot ${slot}: ${stickers.join("")}`,
      );
    }
    cornerPieces[slot] = found.piece;
    cornerOrientation[slot] = found.orientation;
  }

  const edgePieces = new Array<number>(12).fill(0);
  const edgeOrientation = new Array<number>(12).fill(0);
  for (let slot = 0; slot < 12; slot++) {
    const stickers = EDGE_FACELETS[slot].map((i) => facelets[i]);
    const found = findCubie(EDGE_COLORS, stickers);
    if (!found) {
      throw new InvalidFaceletsError(
        `Unrecognised edge at slot ${slot}: ${stickers.join("")}`,
      );
    }
    edgePieces[slot] = found.piece;
    edgeOrientation[slot] = found.orientation;
  }

  return new KPattern(kpuzzle, {
    EDGES: { pieces: edgePieces, orientation: edgeOrientation },
    CORNERS: { pieces: cornerPieces, orientation: cornerOrientation },
    CENTERS: {
      pieces: CENTER_FACELETS.map((i) =>
        CENTER_COLORS.indexOf(facelets[i] as (typeof CENTER_COLORS)[number]),
      ),
      orientation: [0, 0, 0, 0, 0, 0],
    },
  });
}

/**
 * Locate which cubie carries `stickers`, and by how much it is rotated within its slot.
 * Returns `null` when no piece matches, which means the facelet string is not a valid cube.
 */
function findCubie(
  table: readonly string[][],
  stickers: string[],
): { piece: number; orientation: number } | null {
  for (let piece = 0; piece < table.length; piece++) {
    const home = table[piece];
    for (let orientation = 0; orientation < home.length; orientation++) {
      let match = true;
      for (let k = 0; k < home.length; k++) {
        if (stickers[(k + orientation) % home.length] !== home[k]) {
          match = false;
          break;
        }
      }
      if (match) return { piece, orientation };
    }
  }
  return null;
}
