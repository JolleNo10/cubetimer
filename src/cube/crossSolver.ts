/**
 * The shortest cross, exactly.
 *
 * A cross is only four edges, so the whole problem has 331,776 encodable states and
 * fits in a table. Breadth-first search from the finished cross gives the true
 * distance for every one of them — no heuristics, no depth limit, no waiting — which
 * is the number to compare a solve's cross against.
 *
 * The general-purpose search cannot answer this: it wants a whole cube to aim at,
 * and a cross says nothing about the other sixteen pieces.
 */
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { EDGES_OF_FACE, type Face } from "./moves";
import { FACES } from "./moves";

const EDGE_SLOTS = 12;
const CODES = EDGE_SLOTS * 2; // a slot, and which way round the piece sits in it

const STATES = CODES ** 4;

export const CROSS_MOVES = FACES.flatMap((face) => [face, `${face}2`, `${face}'`]);
const QUARTER_TURNS = CROSS_MOVES;

/** How many distinct (slot, orientation) an edge can be in. */
export const EDGE_CODES = CODES;

/** Where each edge code goes, per move. Shared with the cross planner. */
export function edgeMoveTables(kpuzzle: KPuzzle): MoveTable {
  return buildMoveTable(kpuzzle);
}

/** Where a piece in each (slot, orientation) ends up after a move. */
type MoveTable = Uint8Array[];

function buildMoveTable(kpuzzle: KPuzzle): MoveTable {
  return QUARTER_TURNS.map((move) => {
    const moved = kpuzzle.defaultPattern().applyMove(move).patternData.EDGES;
    const table = new Uint8Array(CODES);
    for (let destination = 0; destination < EDGE_SLOTS; destination++) {
      const source = moved.pieces[destination];
      const flip = moved.orientation[destination];
      for (let orientation = 0; orientation < 2; orientation++) {
        table[source * 2 + orientation] =
          destination * 2 + ((orientation + flip) % 2);
      }
    }
    return table;
  });
}

/** Pack the four cross pieces' whereabouts into a single number. */
function encode(codes: readonly number[]): number {
  return codes[0] + CODES * (codes[1] + CODES * (codes[2] + CODES * codes[3]));
}

function decode(index: number): number[] {
  const codes: number[] = [];
  let rest = index;
  for (let i = 0; i < 4; i++) {
    codes.push(rest % CODES);
    rest = Math.floor(rest / CODES);
  }
  return codes;
}

export class CrossSolver {
  readonly #moves: MoveTable;
  readonly #distance: Uint8Array;

  private constructor(moves: MoveTable, distance: Uint8Array) {
    this.#moves = moves;
    this.#distance = distance;
  }

  /**
   * Build the table. The cross is solved on `D`; a cross on another face is handled by
   * looking at it from the right way up before asking.
   */
  static build(kpuzzle: KPuzzle): CrossSolver {
    const moves = buildMoveTable(kpuzzle);
    const distance = new Uint8Array(STATES).fill(255);

    const solvedCodes = EDGES_OF_FACE.D.map((slot) => slot * 2);
    const start = encode(solvedCodes);
    distance[start] = 0;

    let frontier = [start];
    for (let depth = 1; frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const index of frontier) {
        const codes = decode(index);
        for (const table of moves) {
          const moved = encode([
            table[codes[0]],
            table[codes[1]],
            table[codes[2]],
            table[codes[3]],
          ]);
          if (distance[moved] !== 255) continue;
          distance[moved] = depth;
          next.push(moved);
        }
      }
      frontier = next;
    }
    return new CrossSolver(moves, distance);
  }

  /** Where the four cross pieces are in a given state. */
  #codesFor(pattern: KPattern): number[] {
    const edges = pattern.patternData.EDGES;
    const codes = new Array<number>(4);
    for (let slot = 0; slot < EDGE_SLOTS; slot++) {
      const piece = edges.pieces[slot];
      const which = EDGES_OF_FACE.D.indexOf(piece);
      if (which !== -1) codes[which] = slot * 2 + edges.orientation[slot];
    }
    return codes;
  }

  /** How many moves the cross needs from here, at best. */
  lengthFrom(pattern: KPattern): number {
    return this.#distance[encode(this.#codesFor(pattern))];
  }

  /** The same, for a state already reduced to its four cross edges. */
  lengthForCodes(codes: readonly number[]): number {
    return this.#distance[encode(codes)];
  }

  /** The cross pieces of a state, as codes. */
  codesFor(pattern: KPattern): number[] {
    return this.#codesFor(pattern);
  }

  /**
   * One shortest cross, as moves. Walking down the distance table one move at a time
   * cannot go wrong: every state has a neighbour one step closer.
   */
  solve(pattern: KPattern): string[] {
    let codes = this.#codesFor(pattern);
    const solution: string[] = [];
    let remaining = this.#distance[encode(codes)];
    while (remaining > 0) {
      for (const [i, table] of this.#moves.entries()) {
        const moved = [
          table[codes[0]],
          table[codes[1]],
          table[codes[2]],
          table[codes[3]],
        ];
        if (this.#distance[encode(moved)] !== remaining - 1) continue;
        solution.push(QUARTER_TURNS[i]);
        codes = moved;
        remaining--;
        break;
      }
    }
    return solution;
  }
}

let cached: { kpuzzle: KPuzzle; solver: CrossSolver } | null = null;

/** The shared table, built the first time anything asks for it. */
export function crossSolver(kpuzzle: KPuzzle): CrossSolver {
  if (cached?.kpuzzle !== kpuzzle) {
    cached = { kpuzzle, solver: CrossSolver.build(kpuzzle) };
  }
  return cached.solver;
}

export type { Face };
