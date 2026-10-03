import type { KPattern } from "cubing/kpuzzle";
import type { ScrambleTracker } from "../cube/scramble";
import { algBetween } from "../cube/solver";

export type Recovery = { alg: string; resumeAt: number };

export async function calculateRecovery(
  current: KPattern,
  tracker: ScrambleTracker,
): Promise<Recovery> {
  const [backToLast, straightToEnd] = await Promise.all([
    algBetween(current, tracker.lastKnownPattern),
    algBetween(current, tracker.targetPattern),
  ]);
  const backLength = backToLast.experimentalNumChildAlgNodes();
  const endLength = straightToEnd.experimentalNumChildAlgNodes();
  return backLength <= endLength
    ? { alg: backToLast.toString(), resumeAt: tracker.lastKnownMove }
    : { alg: straightToEnd.toString(), resumeAt: tracker.moves.length };
}

