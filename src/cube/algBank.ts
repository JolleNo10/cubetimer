/**
 * Every algorithm a solver might plausibly have used, per case.
 *
 * The tables in `lastLayerCases.ts` and `f2lCases.ts` hold one algorithm each, picked
 * so the recogniser can learn what a case looks like. One is plenty for that — running
 * any correct algorithm backwards produces the same state — but it is far too narrow
 * for the opposite question. Working out which way round the cube was being held means
 * asking "does what they turned look like a real algorithm for the case they were
 * looking at", and a solver turns whichever algorithm they happened to learn.
 *
 * So this is a second, wider table: four algorithms per case, per slot for F2L, from
 * the same source. It is used only to recognise a frame, never to teach one, which is
 * why a miss costs nothing — the gyroscope still has the last word.
 *
 * The data itself lives in `algBank.generated.ts`, written by `scripts/fetchAlgs.ts`.
 * Only the checks are here: the script runs them before writing anything, and the test
 * runs them again over what was committed, so the bank cannot rot unnoticed.
 */
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { recogniseOll, recognisePll, withCentresHome } from "./recognise";
import { F2L_CASES } from "./f2lCases";

/** The four slots a first-two-layers pair can go into, in speedcubedb's order. */
export const F2L_SLOTS = ["FR", "FL", "BL", "BR"] as const;
export type F2lSlot = (typeof F2L_SLOTS)[number];

/** Last-layer pieces are the first four of each orbit in cubing.js's ordering. */
const LAST_LAYER_SLOTS = 4;
const EDGES = 12;
const CORNERS = 8;

/**
 * Whether the cross and all four pairs are in place.
 *
 * Deliberately says nothing about the last layer: an algorithm may leave it anywhere,
 * and the solver's final alignment is their own business.
 */
export function isF2lSolved(pattern: KPattern): boolean {
  const { EDGES: edges, CORNERS: corners } = pattern.patternData;
  for (let i = LAST_LAYER_SLOTS; i < EDGES; i++) {
    if (edges.pieces[i] !== i || edges.orientation[i] !== 0) return false;
  }
  for (let i = LAST_LAYER_SLOTS; i < CORNERS; i++) {
    if (corners.pieces[i] !== i || corners.orientation[i] !== 0) return false;
  }
  return true;
}

function lastLayerOriented(pattern: KPattern): boolean {
  const { EDGES: edges, CORNERS: corners } = pattern.patternData;
  for (let i = 0; i < LAST_LAYER_SLOTS; i++) {
    if (edges.orientation[i] !== 0 || corners.orientation[i] !== 0) return false;
  }
  return true;
}

function lastLayerPermuted(pattern: KPattern): boolean {
  const { EDGES: edges, CORNERS: corners } = pattern.patternData;
  for (let i = 0; i < LAST_LAYER_SLOTS; i++) {
    if (edges.pieces[i] !== i || corners.pieces[i] !== i) return false;
  }
  return true;
}

/** The state an algorithm leaves behind, with any rotation it ended on undone. */
function after(kpuzzle: KPuzzle, pattern: KPattern, algorithm: string): KPattern | null {
  try {
    return withCentresHome(kpuzzle, pattern.applyAlg(new Alg(algorithm)));
  } catch {
    return null; // Notation the parser will not take.
  }
}

/** Every way of holding a cube, as the rotations that reach them. */
const GRIPS = ["", "x", "x2", "x'", "z", "z'"].flatMap((tip) =>
  ["", "y", "y2", "y'"].map((spin) => `${tip} ${spin}`.trim()),
);

/**
 * Whether an algorithm really is a last-layer algorithm, and the case it leaves.
 *
 * Run backwards from solved it has to leave the first two layers standing — an
 * algorithm that takes the cube apart and puts it back is not one a solver used on a
 * last layer, however the top happens to end up looking.
 *
 * Which way up that state comes out depends on how the algorithm was written. Plenty
 * of them begin with a rotation, so the solver is looking at the last layer from the
 * side until they turn the cube; and plenty end without turning it back. Every grip is
 * therefore tried, which is no weaker a test — a case is the same case whichever way
 * it is held — and it stops a perfectly good algorithm being thrown away for being
 * written from an unusual angle.
 */
function lastLayerStateOf(kpuzzle: KPuzzle, algorithm: string): KPattern | null {
  let inverted: string;
  try {
    inverted = new Alg(algorithm).invert().toString();
  } catch {
    return null;
  }
  const state = after(kpuzzle, kpuzzle.defaultPattern(), inverted);
  if (!state) return null;
  for (const grip of GRIPS) {
    const held = grip === "" ? state : after(kpuzzle, state, grip);
    if (held && isF2lSolved(held)) return held;
  }
  return null;
}

/**
 * The OLL case an algorithm solves, by the same reckoning the recogniser uses.
 *
 * `recogniseOll` is deliberately not called here: it would name a case for a state
 * whose first two layers are in pieces. This is the stricter question.
 */
export function ollCaseSolvedBy(kpuzzle: KPuzzle, algorithm: string): string | null {
  const state = lastLayerStateOf(kpuzzle, algorithm);
  if (!state || lastLayerOriented(state)) return null;
  return recogniseOll(kpuzzle, state);
}

/** The PLL case an algorithm solves. A PLL state is oriented but out of order. */
export function pllCaseSolvedBy(kpuzzle: KPuzzle, algorithm: string): string | null {
  const state = lastLayerStateOf(kpuzzle, algorithm);
  if (!state || !lastLayerOriented(state) || lastLayerPermuted(state)) return null;
  return recognisePll(kpuzzle, state);
}

/**
 * The state an F2L case presents when its pair belongs to a given slot.
 *
 * The cases are written for the front-right slot, so the setup is conjugated by a
 * rotation to move the whole problem round the cube. The rotation cancels itself out,
 * which is what leaves the centres where they started.
 */
export function f2lCaseState(
  kpuzzle: KPuzzle,
  caseName: string,
  quarterTurns: number,
): KPattern | null {
  const found = F2L_CASES.find((entry) => entry.name === caseName);
  if (!found) return null;
  const y = "y ".repeat(quarterTurns).trim();
  const back = "y' ".repeat(quarterTurns).trim();
  try {
    return kpuzzle
      .defaultPattern()
      .applyAlg(new Alg([y, found.setup, back].filter(Boolean).join(" ")));
  } catch {
    return null;
  }
}

/**
 * Whether an algorithm finishes the first two layers from a case presented in a slot.
 *
 * A behavioural check rather than a lookup: whatever the algorithm is written as, the
 * pair either goes in or it does not.
 */
export function f2lAlgSolves(
  kpuzzle: KPuzzle,
  caseName: string,
  quarterTurns: number,
  algorithm: string,
): boolean {
  const state = f2lCaseState(kpuzzle, caseName, quarterTurns);
  if (!state) return false;
  const finished = after(kpuzzle, state, algorithm);
  return finished !== null && isF2lSolved(finished);
}
