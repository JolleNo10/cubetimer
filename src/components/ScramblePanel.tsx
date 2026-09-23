import { useController } from "../hooks/useController";
import { eventInfo } from "../cube/scramble";
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
          {state.settings.slowSolve && state.lastSolve ? (
            <button className="ghost" onClick={() => controller.replayScramble(state.lastSolve!.scramble)}>
              Replay last
            </button>
          ) : null}
          {state.settings.slowSolve && eventInfo(state.settings.event).smart ? (
            <>
              <label className="row small" title="Maximum length of the XCross solution">
                <span className="faint">XCross ≤</span>
                <select
                  aria-label="XCross maximum moves"
                  value={state.settings.xCrossMaxMoves}
                  onChange={(e) =>
                    void controller.updateSettings({
                      xCrossMaxMoves: Number(e.target.value) as 4 | 5 | 6,
                    })
                  }
                >
                  {[4, 5, 6].map((moves) => (
                    <option key={moves} value={moves}>
                      {moves}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ghost"
                disabled={state.xCrossGenerating}
                onClick={() => void controller.findXCrossScramble()}
                title={`Find a scramble with an XCross in ${state.settings.xCrossMaxMoves} moves or fewer`}
              >
                XCross
              </button>
            </>
          ) : null}
          <button className="ghost" onClick={() => void controller.newScramble()}>
            New
          </button>
        </div>
      </div>
      <div className="panel-body">
        {state.xCrossGenerating ? (
          <div className="generation-status" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            Generating XCross…
          </div>
        ) : scramble ? (
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
