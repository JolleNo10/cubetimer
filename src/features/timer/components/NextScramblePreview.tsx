import { useController, useStoreValue } from "../../../app/useController";

/**
 * The scramble waiting for the next solve, shown above the result in the scramble
 * panel's place so the next solve can begin from there. The Timer made it when the
 * last solve was recorded.
 */
export function NextScramblePreview({ onContinue }: { onContinue: () => void }) {
  const controller = useController();
  const scramble = useStoreValue(controller.timer.state, state => state.scramble);
  const phase = useStoreValue(controller.timer.state, state => state.phase);
  const hasCube = useStoreValue(controller.physical.state,
    state => state.cubeStatus === "connected" || state.virtualCube);
  const moves = scramble.split(/\s+/).filter(Boolean);

  return (
    <div className="panel scramble-panel next-scramble-panel" aria-label="Next scramble">
      <div className="panel-head">
        <span className="panel-title">Next scramble</span>
        <div className="row scramble-actions">
          <span className="faint small">{hasCube ? "start turning the cube, or" : "hold Space, or"}</span>
          <button className="primary" onClick={onContinue}>
            Next solve
          </button>
        </div>
      </div>
      <div className="panel-body">
        {moves.length ? (
          <div className="scramble">
            {moves.map((move, i) => <span key={i} className="scramble-move">{move}</span>)}
          </div>
        ) : (
          <div className="center faint">
            {phase === "finished" ? "A new scramble is made when you continue." : "Generating a scramble…"}
          </div>
        )}
      </div>
    </div>
  );
}
