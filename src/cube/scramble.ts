import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { randomScrambleForEvent } from "cubing/scramble";
import { patternToFacelets } from "./facelets";
import { parseFaceMove } from "./moves";

export const EVENTS = [
  { id: "333", name: "3x3x3", puzzle: "3x3x3", smart: true },
  { id: "222", name: "2x2x2", puzzle: "2x2x2", smart: false },
  { id: "444", name: "4x4x4", puzzle: "4x4x4", smart: false },
  { id: "555", name: "5x5x5", puzzle: "5x5x5", smart: false },
  { id: "666", name: "6x6x6", puzzle: "6x6x6", smart: false },
  { id: "777", name: "7x7x7", puzzle: "7x7x7", smart: false },
  { id: "333oh", name: "3x3x3 One-Handed", puzzle: "3x3x3", smart: true },
  { id: "333bf", name: "3x3x3 Blindfolded", puzzle: "3x3x3", smart: true },
  { id: "pyram", name: "Pyraminx", puzzle: "pyraminx", smart: false },
  { id: "skewb", name: "Skewb", puzzle: "skewb", smart: false },
  { id: "sq1", name: "Square-1", puzzle: "square1", smart: false },
  { id: "minx", name: "Megaminx", puzzle: "megaminx", smart: false },
  { id: "clock", name: "Clock", puzzle: "clock", smart: false },
] as const;

export type EventId = (typeof EVENTS)[number]["id"];

export function eventInfo(id: EventId) {
  return EVENTS.find((e) => e.id === id) ?? EVENTS[0];
}

/** WCA-style random-state scramble from cubing.js (runs in a worker). */
export async function generateScramble(event: EventId): Promise<string> {
  const alg = await randomScrambleForEvent(event);
  return alg.toString();
}

export type ScrambleProgress = {
  /** How many whole scramble moves are currently applied to the cube. */
  index: number;
  /** Total moves in the scramble. */
  total: number;
  /** True when a half turn has been started but not finished. */
  partial: boolean;
  /** False when the cube is in a state that is not any prefix of the scramble. */
  onTrack: boolean;
  /** True when the cube is exactly in the scrambled state. */
  done: boolean;
  /** Next move the solver should make, when on track. */
  nextMove: string | null;
};

/**
 * Follows the cube along a scramble.
 *
 * Rather than assuming the user applies moves in order, every state is matched against
 * every prefix of the scramble. That makes undos, over-turns and hand-scrambling all
 * behave sensibly: the progress simply jumps to wherever the cube actually is.
 *
 * Prefixes are tracked a quarter turn at a time, because cubes report `R2` as two
 * separate `R` moves and the cube is genuinely between two prefixes in between.
 */
export class ScrambleTracker {
  /** Scramble moves as written, e.g. `["R2", "U'"]`. */
  readonly moves: string[];
  /** Index into `prefixStates` at which each written move is complete. */
  readonly #moveEnd: number[];
  readonly #prefixStates: string[];
  readonly #prefixPatterns: KPattern[];
  readonly targetPattern: KPattern;
  #index = 0;

  constructor(kpuzzle: KPuzzle, scramble: string) {
    this.moves = Array.from(new Alg(scramble).expand().childAlgNodes())
      .map((n) => n.toString())
      .filter((s) => s.length > 0);

    let pattern = kpuzzle.defaultPattern();
    this.#prefixStates = [patternToFacelets(pattern)];
    this.#prefixPatterns = [pattern];
    this.#moveEnd = [];
    for (const move of this.moves) {
      for (const quarter of quarterTurns(move)) {
        pattern = pattern.applyMove(quarter);
        this.#prefixStates.push(patternToFacelets(pattern));
        this.#prefixPatterns.push(pattern);
      }
      this.#moveEnd.push(this.#prefixStates.length - 1);
    }
    this.targetPattern = pattern;
  }

  get index(): number {
    return this.#index;
  }

  /** The state the cube was in last time it was on the scramble. */
  get lastKnownPattern(): KPattern {
    return this.#prefixPatterns[this.#index];
  }

  /** How many written moves are complete at the last known position. */
  get lastKnownMove(): number {
    return this.#moveEnd.filter((end) => end <= this.#index).length;
  }

  /** Recompute progress for the cube's current state. */
  update(pattern: KPattern): ScrambleProgress {
    const facelets = patternToFacelets(pattern);
    let best = -1;
    for (let i = 0; i < this.#prefixStates.length; i++) {
      if (this.#prefixStates[i] !== facelets) continue;
      if (best === -1 || Math.abs(i - this.#index) < Math.abs(best - this.#index)) {
        best = i;
      }
    }
    const onTrack = best !== -1;
    if (onTrack) this.#index = best;
    const at = onTrack ? best : this.#index;
    const completed = this.#moveEnd.filter((end) => end <= at).length;
    return {
      index: completed,
      total: this.moves.length,
      partial: onTrack && completed < this.moves.length && at > (this.#moveEnd[completed - 1] ?? 0),
      onTrack,
      done: onTrack && at === this.#prefixStates.length - 1,
      nextMove: completed < this.moves.length ? this.moves[completed] : null,
    };
  }
}

/** Split a written move into the quarter turns a cube actually reports. */
function quarterTurns(move: string): string[] {
  const parsed = parseFaceMove(move);
  if (!parsed) return [move];
  if (parsed.amount === 2) return [parsed.face, parsed.face];
  return [parsed.amount === -1 ? `${parsed.face}'` : parsed.face];
}
