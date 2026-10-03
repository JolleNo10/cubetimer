import type { TimedMove } from "../../../cube/notation";

export type ReplayAction = {
  /** The visible action sent to TwistyPlayer. */
  move: string;
  /** The raw smart-cube move that caused this action. */
  rawIndex: number;
  /** The recorded completion timestamp of the raw move. */
  rawTimeMs: number;
  /** The internal time used to schedule this visible action. */
  playbackTimeMs: number;
  /** True only for the final action generated from the raw move. */
  completesRawMove: boolean;
  /** Whether this is an inserted grip rotation or the raw turn. */
  source: "grip-rotation" | "raw-turn";
  /** The action's order within the inserted rotation sequence. */
  rotationOrdinal?: number;
};

/** Build a visible replay timeline from already-expanded actions for each raw move. */
export function buildReplayTimeline(
  expandedMoves: readonly (readonly string[])[],
  rawMoves: readonly TimedMove[],
): ReplayAction[] {
  const actions: ReplayAction[] = [];

  for (let rawIndex = 0; rawIndex < rawMoves.length; rawIndex++) {
    const rawMove = rawMoves[rawIndex];
    const expanded = expandedMoves[rawIndex]?.length
      ? expandedMoves[rawIndex]
      : [rawMove.move];
    const startTime = rawIndex === 0 ? 0 : rawMoves[rawIndex - 1].t;
    const actionCount = expanded.length;

    expanded.forEach((move, actionIndex) => {
      const isRawTurn = actionIndex === actionCount - 1;
      actions.push({
        move,
        rawIndex,
        rawTimeMs: rawMove.t,
        playbackTimeMs:
          startTime + ((rawMove.t - startTime) * (actionIndex + 1)) / actionCount,
        completesRawMove: isRawTurn,
        source: isRawTurn ? "raw-turn" : "grip-rotation",
        ...(isRawTurn ? {} : { rotationOrdinal: actionIndex }),
      });
    });
  }

  return actions;
}

/** Project a replay-action cursor position back into the raw move stream. */
export function rawPositionAtReplayIndex(
  actions: readonly ReplayAction[],
  replayIndex: number,
): number {
  if (replayIndex <= 0 || actions.length === 0) return 0;
  const lastAction = actions[Math.min(replayIndex, actions.length) - 1];
  return lastAction.completesRawMove ? lastAction.rawIndex + 1 : lastAction.rawIndex;
}

/** Find the replay cursor position immediately before a raw move begins. */
export function replayIndexForRawPosition(
  actions: readonly ReplayAction[],
  rawPosition: number,
): number {
  const firstAction = actions.findIndex((action) => action.rawIndex >= rawPosition);
  return firstAction === -1 ? actions.length : firstAction;
}
