/**
 * Which F2L case is in front of you, slot by slot.
 *
 * An F2L case is two pieces — a corner and the edge that sits beside it — and nothing
 * else. Where the other fourteen pieces are does not change which case it is, so a
 * case is exactly "where are these two, and which way round". There are 150 ways for a
 * pair to stand with both pieces reachable: one is solved and the other 149 are the 41
 * cases, counted four times over for the four ways the last layer can be turned
 * underneath them. Every one of the 149 is in the table, so recognition never fails
 * for want of an entry.
 *
 * The four slots are the same problem seen from four sides. Rather than keep four
 * tables, the cube is re-expressed so the slot in question is at the front right, and
 * the one table answers for all of them — with the rotation that got it there written
 * in front of the algorithm, since that is the turn the solver has to make.
 */
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { F2L_CASES } from "./f2lCases";
import { f2lSlotsForCrossFace } from "./moves";
import { joinMoves } from "./notation";
import { reframe } from "./recognise";

/**
 * The four slots beside a cross on `D`, in the order a `y` rotation carries them
 * round: front-right, front-left, back-left, back-right.
 */
export const F2L_SLOTS = f2lSlotsForCrossFace("D");

const FRONT_RIGHT = F2L_SLOTS[0];

/** Slot indices a piece can be in and still be free to go straight into the slot. */
const LAST_LAYER_CORNERS = 4;
const LAST_LAYER_EDGES = 4;

/**
 * Bring a slot to the front right. Rotating the cube by `y` carries the front-right
 * slot to the front left, so the slot `n` steps along needs `n` steps back.
 */
const TO_FRONT_RIGHT = ["", "y'", "y2", "y"];

/** The last-layer turn a case can be found under, and the turn that undoes it. */
const AUF = ["", "U", "U2", "U'"];
const UNDO_AUF = ["", "U'", "U2", "U"];

/**
 * Where the front-right pair's two pieces are standing.
 *
 * `null` when either of them is buried in one of the other three slots or down among
 * the cross edges. That is not one of the 41 cases: the pair has to come out before it
 * can go in, and which case it then is depends on how it comes out.
 */
function pairKey(pattern: KPattern): string | null {
  const { CORNERS, EDGES } = pattern.patternData;
  const corner = CORNERS.pieces.indexOf(FRONT_RIGHT.corner);
  const edge = EDGES.pieces.indexOf(FRONT_RIGHT.edge);
  const cornerFree = corner < LAST_LAYER_CORNERS || corner === FRONT_RIGHT.corner;
  const edgeFree = edge < LAST_LAYER_EDGES || edge === FRONT_RIGHT.edge;
  if (!cornerFree || !edgeFree) return null;
  return `${corner}.${CORNERS.orientation[corner]}|${edge}.${EDGES.orientation[edge]}`;
}

/** True when the pair is already home. */
const SOLVED_KEY = `${FRONT_RIGHT.corner}.0|${FRONT_RIGHT.edge}.0`;

export type Entry = {
  name: string;
  group: string;
  /** Last-layer turns between this state and the one the algorithm is written for. */
  auf: number;
  /** A `y` the algorithm opens with, which belongs in front of the lining-up turn. */
  rotation: string[];
  /** The rest of the algorithm. */
  body: string[];
};

/**
 * Split off any rotation an algorithm opens with.
 *
 * Only a `y` is taken: it leaves the last layer where it is, so the turn that lines
 * the layer up can go in front of the algorithm or behind the rotation and mean the
 * same thing — and behind it is where it may cancel with the algorithm's own first
 * turn. An `x` or a `z` would not commute like that, and none of these algorithms
 * opens with one.
 */
function splitLeadingRotation(alg: string): { rotation: string[]; body: string[] } {
  const tokens = alg.split(" ");
  const lead = tokens.findIndex((token) => !/^y[2']?$/.test(token));
  return {
    rotation: tokens.slice(0, lead === -1 ? tokens.length : lead),
    body: lead === -1 ? [] : tokens.slice(lead),
  };
}

const tables = new WeakMap<KPuzzle, Map<string, Entry>>();

export function f2lTable(kpuzzle: KPuzzle): Map<string, Entry> {
  const existing = tables.get(kpuzzle);
  if (existing) return existing;
  const table = new Map<string, Entry>();
  for (const { name, group, setup, alg } of F2L_CASES) {
    const state = kpuzzle.defaultPattern().applyAlg(new Alg(setup));
    for (let auf = 0; auf < 4; auf++) {
      const key = pairKey(state.applyAlg(new Alg(AUF[auf])));
      // First writer wins, so a genuine clash would be visible rather than silently
      // overwritten; the tests assert there are none.
      if (key !== null && !table.has(key)) {
        table.set(key, { name, group, auf, ...splitLeadingRotation(alg) });
      }
    }
  }
  tables.set(kpuzzle, table);
  return table;
}

export type F2lSolution = {
  /** The case's number, as `"F2L 12"`. */
  name: string;
  group: string;
  /**
   * What to do, in the grip the cube is being held in: the rotation that brings the
   * slot to the front right, the turn that lines the last layer up, then the algorithm.
   */
  moves: string[];
};

export type F2lSlotPlan = {
  /** The slot, named after its edge: `"FR"`, `"BL"` … */
  name: string;
  /**
   * `solved` — nothing to do. `case` — one of the 41, with the moves for it.
   * `buried` — a piece of this pair is sitting in another slot and has to come out
   * first, which is a consequence of solving one of the other slots rather than a
   * case of its own.
   */
  status: "solved" | "case" | "buried";
  solution: F2lSolution | null;
};

/**
 * Read all four slots.
 *
 * `pattern` must already be turned so the cross face is on the bottom and the solver's
 * front face is at the front, the same frame `planCross` works in. The slots come back
 * in a fixed order so the panel does not reshuffle itself as the cube is turned.
 */
export function planF2l(kpuzzle: KPuzzle, pattern: KPattern): F2lSlotPlan[] {
  const table = f2lTable(kpuzzle);
  return F2L_SLOTS.map((slot, index) => {
    const rotation = TO_FRONT_RIGHT[index];
    const framed = rotation
      ? reframe(kpuzzle, pattern, new Alg(rotation))
      : pattern;
    const key = pairKey(framed);
    if (key === SOLVED_KEY) return { name: slot.name, status: "solved", solution: null };
    const entry = key === null ? undefined : table.get(key);
    if (!entry) return { name: slot.name, status: "buried", solution: null };
    return {
      name: slot.name,
      status: "case",
      solution: {
        name: entry.name,
        group: entry.group,
        moves: joinMoves(
          rotation ? [rotation] : [],
          entry.rotation,
          UNDO_AUF[entry.auf] ? [UNDO_AUF[entry.auf]] : [],
          entry.body,
        ),
      },
    };
  });
}
