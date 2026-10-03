import type { KPattern } from "cubing/kpuzzle";
import type { ScrambleTracker } from "../cube/scramble";
import { algBetween } from "../cube/solver";

export type Recovery = { alg: string; resumeAt: number };

export async function calculateRecovery(
  current: KPattern,
  tracker: ScrambleTracker,
): Promise<Recovery> {
  const lastKnownPattern = tracker.lastKnownPattern;
  const targetPattern = tracker.targetPattern;
  const lastKnownMove = tracker.lastKnownMove;
  const targetMove = tracker.moves.length;
  const [backToLast, straightToEnd] = await Promise.all([
    algBetween(current, lastKnownPattern),
    algBetween(current, targetPattern),
  ]);
  const backLength = backToLast.experimentalNumChildAlgNodes();
  const endLength = straightToEnd.experimentalNumChildAlgNodes();
  return backLength <= endLength
    ? { alg: backToLast.toString(), resumeAt: lastKnownMove }
    : { alg: straightToEnd.toString(), resumeAt: targetMove };
}
