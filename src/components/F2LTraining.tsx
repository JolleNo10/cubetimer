import { useController, useStore } from "../hooks/useController";
import { F2L_CASES } from "../cube/f2lCases";
import { faceColour, slotColours } from "../cube/colours";
import { formatTime } from "../state/stats";
import type { AppState } from "../state/controller";
import { ConnectionPanel } from "./ConnectionPanel";
import { CubeView } from "./CubeView";

const GROUPS = [...new Set(F2L_CASES.map((f2lCase) => f2lCase.group))];

export function F2LTraining({ state }: { state: AppState }) {
  const controller = useController();
  const elapsed = useStore(controller.elapsed);
  const live = state.cubeStatus === "connected" || state.virtualCube;
  const training = state.f2lTraining;
  const target = training.target;

  return (
    <div className="app-body f2l-training-layout">
      <div className="column left">
        <ConnectionPanel state={state} />
        <div className="panel f2l-library">
          <div className="panel-head">
            <span className="panel-title">F2L cases</span>
            <span className="chip small">41 cases</span>
          </div>
          <div className="panel-body">
            {GROUPS.map((group) => (
              <section className="f2l-group" key={group}>
                <div className="small faint">{group}</div>
                <div className="f2l-case-grid">
                  {F2L_CASES.filter((f2lCase) => f2lCase.group === group).map((f2lCase) => {
                    const selected = target?.origin.kind === "standard"
                      ? target.origin.caseName === f2lCase.name
                      : target?.reference?.caseName === f2lCase.name;
                    return (
                      <button
                        type="button"
                        key={f2lCase.name}
                        className={`f2l-case-button${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => void controller.selectF2lCase(f2lCase.name)}
                      >
                        {f2lCase.name.replace("F2L ", "#")}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="column">
        {state.error ? (
          <div className="notice error">
            <span className="grow">{state.error}</span>
            <button className="ghost" onClick={() => controller.dismissError()}>
              Dismiss
            </button>
          </div>
        ) : null}
        <SetupPanel state={state} />
        <div className="stage f2l-stage">
          <CubeView
            settings={state.settings}
            facelets={state.cubeFacelets}
            gyroSupported={state.hardware?.gyroSupported ?? false}
            live={live}
            scramble={target?.previewAlg ?? ""}
          />
        </div>
      </div>

      <div className="column right">
        <TargetPanel state={state} elapsed={elapsed} />
      </div>
    </div>
  );
}

function SetupPanel({ state }: { state: AppState }) {
  const controller = useController();
  const training = state.f2lTraining;
  const progress = training.setupProgress;
  const moves = training.setup.split(/\s+/).filter(Boolean);
  const preparing = training.phase === "preparing";
  const offTrack = Boolean(progress && !progress.onTrack);
  const done = progress?.onTrack ? progress.index : 0;

  return (
    <div className="panel f2l-setup-panel">
      <div className="panel-head">
        <span className="panel-title">Setup</span>
        {preparing && progress ? (
          <span className="chip small">{done} / {progress.total}</span>
        ) : null}
      </div>
      <div className="panel-body">
        {!training.target ? (
          <div className="empty">Choose a case to guide the cube into position.</div>
        ) : preparing ? (
          <>
            <div className="small dim">
              Apply the setup from the cube&apos;s current state. The attempt begins on the
              first turn after the target is reached.
            </div>
            <div className="scramble f2l-setup-moves">
              {moves.length > 0 ? moves.map((move, index) => (
                <span
                  key={`${move}-${index}`}
                  className={`scramble-move${index < done ? " done" : ""}${!offTrack && index === done ? " next" : ""}`}
                >
                  {move}
                </span>
              )) : <span className="faint">Already at the target.</span>}
            </div>
            {progress ? (
              <div className="scramble-progress-track" aria-hidden="true">
                <div
                  className="scramble-progress-fill"
                  style={{
                    width: `${progress.total ? (done / progress.total) * 100 : 100}%`,
                    background: offTrack ? "var(--amber)" : "var(--accent)",
                  }}
                />
              </div>
            ) : null}
            {offTrack ? (
              <div className="notice" style={{ marginTop: 12 }}>
                <div>
                  <b>Off the setup.</b>{" "}
                  {training.recovery
                    ? "Apply this sequence to get back on track:"
                    : training.recoveryPending
                      ? "Working out a way back..."
                      : "Turn back toward the target, or re-read the cube."}
                  {training.recovery ? (
                    <div className="mono" style={{ marginTop: 4 }}>
                      {training.recovery.alg || "(already there)"}
                    </div>
                  ) : null}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button onClick={() => void controller.syncFromCube()}>Re-read cube</button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : training.phase === "ready" ? (
          <div className="training-ready" role="status">
            <strong>Ready</strong>
            <span className="small faint">Make one turn to start the attempt.</span>
          </div>
        ) : training.phase === "solving" ? (
          <div className="training-solving" role="status">
            <strong>Solving</strong>
            <span className="mono">{training.liveMoves.length} raw turns</span>
          </div>
        ) : training.phase === "result" ? (
          <div className="training-ready" role="status">
            <strong>Complete</strong>
            <span className="small faint">Choose Again to repeat this setup.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TargetPanel({ state, elapsed }: { state: AppState; elapsed: number }) {
  const controller = useController();
  const training = state.f2lTraining;
  const target = training.target;
  const result = training.result;
  const reference = target?.reference;
  const delta = result?.delta;
  const slotName = target ? slotColours(target.slot) ?? target.slot : null;

  return (
    <div className="panel f2l-target-panel">
      <div className="panel-head">
        <span className="panel-title">Training target</span>
        {training.phase === "result" ? <span className="chip live">result</span> : null}
      </div>
      <div className="panel-body">
        {!target ? (
          <div className="empty">Select one of the 41 cases, or use Practice from a solve review.</div>
        ) : (
          <>
            <div className="f2l-target-title">
              <strong>{target.origin.kind === "standard" ? target.origin.caseName : "Exact F2L setup"}</strong>
              {reference?.group ? <span className="phase-case">{reference.group}</span> : null}
            </div>
            <div className="small dim f2l-origin">
              {target.origin.kind === "standard"
                ? "Standard 41-case target"
                : `From solve - ${target.origin.stepName} - ${slotName ?? target.origin.slot}`}
            </div>
            <div className="f2l-target-facts">
              <span>
                cross <b><i className="colour-dot" style={{ background: faceColour(target.crossFace).hex }} />{faceColour(target.crossFace).name}</b>
              </span>
              <span>slot <b>{slotName}</b></span>
              {target.protectedSlots.length > 0 ? (
                <span>protected <b>{target.protectedSlots.map((slot) => slotColours(slot) ?? slot).join(", ")}</b></span>
              ) : null}
            </div>

            <div className="f2l-reference">
              <div className="result-context-label">REFERENCE</div>
              {reference ? (
                <>
                  <div className="row">
                    <strong>{reference.stm} STM</strong>
                    {reference.caseName ? <span className="phase-case">{reference.caseName}</span> : null}
                  </div>
                  <div className="mono f2l-reference-alg">{reference.alg}</div>
                </>
              ) : (
                <div className="small faint">No standard 41-case reference for this exact setup.</div>
              )}
            </div>

            {result ? (
              <div className="f2l-result-card">
                <div className="result-context-label">ATTEMPT</div>
                <div className="f2l-result-stm mono">{result.stm} STM</div>
                {delta !== null && delta !== undefined ? (
                  <div className={`f2l-delta${delta <= 0 ? " good" : ""}`}>
                    {delta > 0 ? `+${delta}` : delta} STM vs reference
                  </div>
                ) : null}
                <div className="mono f2l-result-moves">{result.moves.join(" ") || "(no turns)"}</div>
                <div className="small faint">elapsed {formatTime(result.elapsedMs || elapsed)}</div>
              </div>
            ) : training.phase === "solving" ? (
              <div className="f2l-live-metric">
                <strong className="mono">{training.liveMoves.length} turns</strong>
                <span className="small faint">elapsed {formatTime(elapsed)}</span>
              </div>
            ) : null}

            <div className="row wrap f2l-actions">
              {training.phase === "result" ? (
                <button className="primary" onClick={() => controller.againF2lTraining()}>
                  Again
                </button>
              ) : null}
              <button className="ghost" onClick={() => controller.resetF2lTraining()}>
                Reset case
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
