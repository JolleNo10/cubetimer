import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { ANALYSIS_VERSION, analyseSolve, type SolveAnalysis } from "../../cube/analysis";
import { decodeGripTrack } from "../../cube/gripTrack";
import { faceletsToPattern } from "../../cube/facelets";
import type { Solve } from "../../app/types";

/**
 * The state a solve began from.
 *
 * Solves recorded here store the exact scrambled state, which is the truthful answer.
 * Imported ones only have the scramble sequence, which comes to the same thing for a
 * scramble that was actually applied.
 */
export function startingPattern(kpuzzle: KPuzzle, solve: Solve): KPattern | null {
  if (solve.scrambledFacelets) {
    try {
      return faceletsToPattern(kpuzzle, solve.scrambledFacelets);
    } catch {
      // Fall through to the scramble.
    }
  }
  if (!solve.scramble) return null;
  try {
    return kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble));
  } catch {
    return null;
  }
}

/** State-only candidate always comes from original facts, never orientation or prior analysis. */
export function buildStateOnlyCfopAnalysis(kpuzzle: KPuzzle, solve: Solve): SolveAnalysis | null {
  if (solve.moves.length === 0) return null;
  const from = startingPattern(kpuzzle, solve);
  if (!from) return null;
  try { return analyseSolve(from, solve.moves, null, {}); }
  catch { return null; }
}

function isCurrent(analysis: SolveAnalysis | null | undefined): boolean {
  return !!analysis && (analysis.analysisVersion ?? 1) >= ANALYSIS_VERSION && analysis.quality !== undefined;
}

/**
 * Rebuild a solve's analysis from the moves it recorded.
 *
 * An analysis is derived data: the scramble and the move stream are the facts, and the
 * breakdown is what this app makes of them. So an analysis that is missing — because it
 * was stored under an older model and could not be read — or that was made by an older
 * version of the analysis is recomputed rather than lost. An outdated analysis that
 * cannot be recomputed, such as an import with no moves, is kept as it is. Returns
 * `null` when there is nothing to do.
 */
export function rebuildAnalysis(kpuzzle: KPuzzle, solve: Solve): Solve | null {
  const correction = solve.cfopAnalysisCorrection;
  const rebuildBase = !isCurrent(solve.analysis);
  const rebuildCorrection = correction && !isCurrent(correction.analysis);
  if ((!rebuildBase && !rebuildCorrection) || solve.moves.length === 0) return null;
  const from = startingPattern(kpuzzle, solve);
  if (!from) return null;
  let rebuilt: Solve | null = null;
  // The readings are long gone, but what they were taken to mean was kept, so the
  // rebuilt breakdown still names the faces the solver was actually looking at.
  if (rebuildBase) {
    const grip = solve.gripTrack ? decodeGripTrack(solve.gripTrack) : null;
    const analysis = analyseSolve(from, solve.moves, grip, { observedStartBottomFace: solve.solveStartBottomFace });
    if (analysis) rebuilt = { ...solve, analysis };
  }
  if (rebuildCorrection) {
    const analysis = buildStateOnlyCfopAnalysis(kpuzzle, solve);
    if (analysis) rebuilt = { ...(rebuilt ?? solve), cfopAnalysisCorrection: { ...correction, analysis } };
  }
  return rebuilt;
}
