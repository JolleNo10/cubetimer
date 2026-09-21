import { cube3x3x3 } from "cubing/puzzles";
import type { KPuzzle } from "cubing/kpuzzle";

let cached: Promise<KPuzzle> | null = null;

/** The shared 3x3x3 `KPuzzle`. Loading it is async, so everything that needs it awaits this. */
export function get3x3x3(): Promise<KPuzzle> {
  cached ??= cube3x3x3.kpuzzle();
  return cached;
}
