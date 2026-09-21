/**
 * What to do next, from where the cube is now.
 *
 * Every way of finishing the cross within a few moves of the shortest is enumerated,
 * and each one is checked to see whether it happens to finish an F2L pair on the way.
 * A cross that also solves a pair is an XCross, and one that solves two is an XXCross;
 * they are not searched for separately, they are simply the good ones that turn up.
 *
 * The search is exact rather than heuristic. The cross distance table says precisely
 * how many moves the cross still needs, so a branch that cannot reach a cross inside
 * the budget is abandoned immediately, and nothing is explored that could not pay off.
 */
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { CROSS_MOVES, crossSolver, edgeMoveTables } from "./crossSolver";
import {
  EDGES_OF_FACE,
  f2lSlotsForCrossFace,
  FACES,
  OPPOSITE,
  type Face,
} from "./moves";
import { parseMove } from "./notation";

const CORNER_CODES = 8 * 3;

/** Where each corner code goes, per move. */
function cornerMoveTables(kpuzzle: KPuzzle): Uint8Array[] {
  return CROSS_MOVES.map((move) => {
    const moved = kpuzzle.defaultPattern().applyMove(move).patternData.CORNERS;
    const table = new Uint8Array(CORNER_CODES);
    for (let destination = 0; destination < 8; destination++) {
      const source = moved.pieces[destination];
      const twist = moved.orientation[destination];
      for (let orientation = 0; orientation < 3; orientation++) {
        table[source * 3 + orientation] =
          destination * 3 + ((orientation + twist) % 3);
      }
    }
    return table;
  });
}

export type CrossPlan = {
  /** The moves to make, in the frame the cube is being held in. */
  moves: string[];
  /** Names of the F2L slots this also finishes, if any. */
  pairs: string[];
};

export type CrossPlans = {
  /** Fewest moves the cross alone needs. */
  shortest: number;
  /** Plans, best first: more pairs solved wins, then fewer moves. */
  plans: CrossPlan[];
  /**
   * True when every plan within the budget was examined, so "no XCross" means there
   * is none rather than that the search ran out of time.
   */
  exhausted: boolean;
};

/** Enough to finish any sane budget; a guard against a pathological case, not a limit. */
const NODE_BUDGET = 8_000_000;

/** How many plans to keep of each kind: plain cross, XCross, XXCross. */
const KEEP_PER_KIND = 5;

/** Deepest plan worth considering, which also bounds the reusable state stack. */
const MAX_PLAN_LENGTH = 16;

/** Slots of the four F2L pairs beside a cross on `D`. */
const PAIRS = f2lSlotsForCrossFace("D");
const CROSS_EDGES = EDGES_OF_FACE.D;

type Search = {
  edges: Uint8Array;
  corners: Uint8Array;
};

/**
 * Plan the cross from here.
 *
 * `pattern` must already be turned so the cross face is on the bottom. `extra` is how
 * many moves beyond the shortest cross to consider: spending one or two more to finish
 * a pair as well is usually worth it, spending five is not.
 */
export function planCross(
  kpuzzle: KPuzzle,
  pattern: KPattern,
  { extra = 3 }: { extra?: number } = {},
): CrossPlans {
  const solver = crossSolver(kpuzzle);
  const edgeTables = edgeMoveTables(kpuzzle);
  const cornerTables = cornerMoveTables(kpuzzle);

  const shortest = solver.lengthFrom(pattern);
  const budget = shortest + extra;

  // Only the twelve pieces a cross and its pairs are made of.
  const edgeState = new Uint8Array(8);
  const cornerState = new Uint8Array(4);
  const edges = pattern.patternData.EDGES;
  const corners = pattern.patternData.CORNERS;
  const watchedEdges = [...CROSS_EDGES, ...PAIRS.map((pair) => pair.edge)];
  for (let slot = 0; slot < 12; slot++) {
    const which = watchedEdges.indexOf(edges.pieces[slot]);
    if (which !== -1) edgeState[which] = slot * 2 + edges.orientation[slot];
  }
  for (let slot = 0; slot < 8; slot++) {
    const which = PAIRS.findIndex((pair) => pair.corner === corners.pieces[slot]);
    if (which !== -1) cornerState[which] = slot * 3 + corners.orientation[slot];
  }

  // Only the best few of each kind are kept. Collecting every plan means tens of
  // thousands of them, nearly all of which are a worse way of doing something already
  // on the list.
  const kept = new Map<number, CrossPlan[]>();
  const keep = (plan: CrossPlan) => {
    const kind = Math.min(plan.pairs.length, 2);
    const list = kept.get(kind) ?? [];
    if (list.length < KEEP_PER_KIND) {
      list.push(plan);
    } else {
      const worst = list.reduce(
        (a, b) => (b.moves.length > a.moves.length ? b : a),
      );
      if (plan.moves.length >= worst.moves.length) return;
      list[list.indexOf(worst)] = plan;
    }
    list.sort((a, b) => a.moves.length - b.moves.length);
    kept.set(kind, list);
  };

  const moves: string[] = [];
  const faceOf = CROSS_MOVES.map((move) => parseMove(move)!.family);
  let visited = 0;
  let exhausted = true;

  const pairsDone = (state: Search) =>
    PAIRS.flatMap((pair, i) =>
      state.corners[i] === pair.corner * 3 &&
      state.edges[CROSS_EDGES.length + i] === pair.edge * 2
        ? [pair.name]
        : [],
    );

  // One buffer per depth, reused: a search of millions of nodes must not allocate.
  const stack: Search[] = Array.from({ length: MAX_PLAN_LENGTH + 1 }, () => ({
    edges: new Uint8Array(8),
    corners: new Uint8Array(4),
  }));

  const step = (state: Search, depth: number, lastFace: string | null) => {
    if (visited++ > NODE_BUDGET) {
      exhausted = false;
      return;
    }
    const toGo = solver.lengthForCodes([
      state.edges[0],
      state.edges[1],
      state.edges[2],
      state.edges[3],
    ]);
    if (toGo === 0) keep({ moves: [...moves], pairs: pairsDone(state) });
    // Nothing below here can finish the cross inside the budget.
    if (depth + Math.max(toGo, 1) > budget) return;

    for (const [i, move] of CROSS_MOVES.entries()) {
      // Turning the same face twice running is always a longer way to say one turn.
      if (faceOf[i] === lastFace) continue;
      // Turns of opposite faces commute, so only one of the two orders is worth
      // exploring; without this every such pair shows up twice.
      if (lastFace !== null && OPPOSITE[faceOf[i] as Face] === lastFace) {
        if (FACES.indexOf(faceOf[i] as Face) > FACES.indexOf(lastFace as Face)) continue;
      }
      if (depth + 1 > MAX_PLAN_LENGTH) continue;
      const next = stack[depth + 1];
      for (let p = 0; p < 8; p++) next.edges[p] = edgeTables[i][state.edges[p]];
      for (let p = 0; p < 4; p++) next.corners[p] = cornerTables[i][state.corners[p]];
      moves.push(move);
      step(next, depth + 1, faceOf[i]);
      moves.pop();
    }
  };

  stack[0].edges.set(edgeState);
  stack[0].corners.set(cornerState);
  step(stack[0], 0, null);

  // Best first: an XXCross beats an XCross beats a plain cross, then shorter wins.
  const plans = [...kept.values()]
    .flat()
    .sort(
      (a, b) => b.pairs.length - a.pairs.length || a.moves.length - b.moves.length,
    );
  return { shortest, plans, exhausted };
}

export { FACES };
