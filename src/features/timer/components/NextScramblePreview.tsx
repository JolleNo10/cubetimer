import { useController, useStoreValue } from "../../../app/useController";

/**
 * The scramble waiting for the next solve, shown on the result screen so the next
 * solve can begin from there. The Timer made it when the last solve was recorded.
 */
export function NextScramblePreview({ onContinue }: { onContinue: () => void }) {
  const controller = useController();
  const scramble = useStoreValue(controller.timer.state, state => state.scramble);
  const phase = useStoreValue(controller.timer.state, state => state.phase);
  const hasCube = useStoreValue(controller.physical.state,
    state => state.cubeStatus === "connected" || state.virtualCube);

  return (
    <div className="result-next-scramble" aria-label="Next scramble">
      <span className="result-context-label">NEXT SCRAMBLE</span>
      {scramble ? (
        <div className="mono result-next-scramble-moves">{scramble}</div>
      ) : (
        <div className="faint small">
          {phase === "finished" ? "A new scramble is made when you continue." : "Generating a scramble…"}
        </div>
      )}
      <div className="result-next-scramble-actions">
        <span className="faint small">{hasCube ? "or start turning the cube" : "or hold Space"}</span>
        <button className="primary" onClick={onContinue}>
          Next solve
        </button>
      </div>
    </div>
  );
}
