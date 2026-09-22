import { useController } from "../hooks/useController";
import type { AppState } from "../state/controller";

/**
 * The scramble, with the moves already applied to the cube struck through.
 * When the cube wanders off the scramble a fix-up sequence is offered instead of
 * making the user start over.
 */
export function ScramblePanel({ state }: { state: AppState }) {
  const controller = useController();
  const { scramble, scrambleProgress: progress, recovery, recoveryPending } = state;
  const moves = scramble.split(/\s+/).filter(Boolean);
  const done = progress?.onTrack ? progress.index : 0;
  const offTrack = progress !== null && !progress.onTrack;
  const tracking = progress !== null && state.phase === "scrambling";

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Scramble</span>
        <div className="row">
          {tracking ? (
            <span className="chip small">
              {done} / {progress.total}
            </span>
          ) : null}
          {state.settings.slowSolve && state.scramble ? (
            <button className="ghost" onClick={() => controller.setScramble(state.scramble)}>
              Replay
            </button>
          ) : null}
          <button className="ghost" onClick={() => void controller.newScramble()}>
            New
          </button>
        </div>
      </div>
      <div className="panel-body">
        {scramble ? (
          <div className="scramble">
            {moves.map((move, i) => (
              <span
                key={i}
                className={
                  "scramble-move" +
                  (tracking && i < done ? " done" : "") +
                  (tracking && !offTrack && i === done ? " next" : "")
                }
              >
                {move}
              </span>
            ))}
          </div>
        ) : (
          <div className="center faint">Generating a scramble…</div>
        )}

        {tracking ? (
          <div className="scramble-progress-track" aria-hidden="true">
            <div
              className="scramble-progress-fill"
              style={{
                width: `${progress.total ? (done / progress.total) * 100 : 0}%`,
                background: offTrack ? "var(--amber)" : "var(--accent)",
              }}
            />
          </div>
        ) : null}

        {offTrack ? (
          <div className="notice" style={{ marginTop: 12 }}>
            <div>
              <div>
                <b>Off the scramble.</b>{" "}
                {recovery
                  ? recovery.resumeAt >= (progress?.total ?? 0)
                    ? "Apply this to reach the scrambled state:"
                    : `Apply this to get back to move ${recovery.resumeAt} of the scramble:`
                  : recoveryPending
                    ? "Working out how to get back…"
                    : "Turn the cube back, or take the current state as the scramble."}
              </div>
              {recovery ? <div className="mono">{recovery.alg || "(already there)"}</div> : null}
              <div className="row" style={{ marginTop: 8 }}>
                <button onClick={() => void controller.useCubeStateAsScramble()}>
                  Use cube state as scramble
                </button>
                <button className="ghost" onClick={() => void controller.syncFromCube()}>
                  Re-read cube
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
