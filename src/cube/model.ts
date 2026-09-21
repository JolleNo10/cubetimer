import { Alg, Move } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { SOLVED_FACELETS, faceletsToPattern, patternToFacelets } from "./facelets";
import { get3x3x3 } from "./puzzle";

/**
 * Mirrors the physical cube. Smart cubes report only face turns, and those turns are
 * expressed relative to the centres, so a `KPattern` kept in step with the move stream
 * stays in sync with reality without needing to know how the cube is being held.
 */
export class CubeModel {
  readonly kpuzzle: KPuzzle;
  #pattern: KPattern;

  constructor(kpuzzle: KPuzzle, pattern?: KPattern) {
    this.kpuzzle = kpuzzle;
    this.#pattern = pattern ?? kpuzzle.defaultPattern();
  }

  static async create(): Promise<CubeModel> {
    return new CubeModel(await get3x3x3());
  }

  get pattern(): KPattern {
    return this.#pattern;
  }

  set pattern(pattern: KPattern) {
    this.#pattern = pattern;
  }

  get facelets(): string {
    return patternToFacelets(this.#pattern);
  }

  get isSolved(): boolean {
    return this.facelets === SOLVED_FACELETS;
  }

  applyMove(move: string | Move): KPattern {
    this.#pattern = this.#pattern.applyMove(move);
    return this.#pattern;
  }

  applyAlg(alg: string | Alg): KPattern {
    this.#pattern = this.#pattern.applyAlg(
      typeof alg === "string" ? new Alg(alg) : alg,
    );
    return this.#pattern;
  }

  /** Adopt the state the cube firmware reports, discarding any drift. */
  setFacelets(facelets: string): KPattern {
    this.#pattern = faceletsToPattern(this.kpuzzle, facelets);
    return this.#pattern;
  }

  reset(): KPattern {
    this.#pattern = this.kpuzzle.defaultPattern();
    return this.#pattern;
  }
}

export { SOLVED_FACELETS, faceletsToPattern, patternToFacelets };
