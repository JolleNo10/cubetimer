import { formatTime } from "../../../shared/time";
import { useEffect, useState, type ReactNode } from "react";
import { useController, useSettings, useStore, useStoreValue, useTrainingState } from "../../../app/useController";
import type { TrainingState } from "../TrainingRuntime";

import { ConnectionPanel } from "../../../shared/ui/ConnectionPanel";
import { CubeView } from "../../../shared/ui/CubeView";
import { TrainingAlgorithmGuide } from "./TrainingAlgorithmGuide";

export function TrainingWorkspace({ library, details, emptyMessage }: {
  library: ReactNode; details: ReactNode; emptyMessage: ReactNode;
}) {
  const controller = useController();
  const family = useStoreValue(controller.training.state, state => state.family);
  const error = useStoreValue(controller.state, state => state.error);
  const f2l = family === "f2l";
  return (
    <div className={`app-body ${f2l ? "f2l-training" : "training"}-layout`}>
      <div className="column left"><ConnectionPanel />{library}</div>
      <div className="column">
        {error ? <div className="notice error"><span className="grow">{error}</span><button className="ghost" onClick={() => controller.dismissError()}>Dismiss</button></div> : null}
        <TrainingSetupPanel />
        <TrainingCubeStage />
      </div>
      <div className="column right">
        <TrainingTargetPanel details={details} emptyMessage={emptyMessage} />
      </div>
    </div>
  );
}

function TrainingTargetPanel({ details, emptyMessage }: { details: ReactNode; emptyMessage: ReactNode }) {
  const controller = useController();
  const family = useStoreValue(controller.training.state, state => state.family);
  const target = useStoreValue(controller.training.state, state => state.target);
  const result = useStoreValue(controller.training.state, state => state.result);
  const f2l = family === "f2l";
  return (
    <div className={`panel ${f2l ? "f2l" : "training"}-target-panel`}>
      <div className="panel-head"><span className="panel-title">Training target</span>{result ? <span className="chip live">result</span> : null}</div>
      <div className="panel-body">
        {!target ? <div className="empty">{emptyMessage}</div> : <>
          {details}
          <TrainingReferences />
          <TrainingAttempt />
          <TrainingActions />
        </>}
      </div>
    </div>
  );
}

function TrainingAttempt() {
  const controller = useController();
  const training = useTrainingState();
  const elapsed = useStore(controller.elapsed);
  return <TrainingAttemptResult result={training.result} phase={training.phase} liveMoveCount={training.liveMoves.length} elapsed={elapsed} />;
}

export function TrainingCubeStage() {
  const controller = useController();
  const settings = useSettings();
  const cubeFacelets = useStoreValue(controller.physical.state, state => state.cubeFacelets);
  const gyroSupported = useStoreValue(controller.physical.state, state => state.hardware?.gyroSupported ?? false);
  const cubeStatus = useStoreValue(controller.physical.state, state => state.cubeStatus);
  const virtualCube = useStoreValue(controller.physical.state, state => state.virtualCube);
  const training = useTrainingState();
  const target = training.target;
  const physicalLive = cubeStatus === "connected" || virtualCube;
  return <div className={`stage ${training.family === "f2l" ? "f2l" : "training"}-stage`}>
    <CubeView settings={settings} facelets={cubeFacelets} gyroSupported={gyroSupported}
      live={training.mode === "virtual" ? Boolean(target) : physicalLive} scramble=""
      displayFacelets={training.displayFacelets || cubeFacelets} displayRevision={training.displayRevision}
      displaySource={training.mode === "virtual" ? "virtual" : "physical"} orientationOverride={target?.trainingRotation.orientation}
      physicalSyncAvailable={cubeStatus === "connected"}
      guideMove={target && target.references.length > 0 && (training.phase === "ready" || training.phase === "solving") && !training.result ? training.guide?.currentMove : null} />
  </div>;
}

export function TrainingActions() {
  const controller = useController();
  const training = useTrainingState();
  const again = training.phase === "result" || (training.family !== "f2l" && Boolean(training.result));
  return <div className="row wrap f2l-actions">
    {again ? <button className="primary" onClick={() => controller.againTraining()}>Again</button> : null}
    <button className="ghost" onClick={() => controller.resetTraining()}>Clear case</button>
  </div>;
}

export function TrainingSetupPanel() {
  const controller = useController();
  const training = useTrainingState();
  const progress = training.setupProgress;
  const moves = training.setup.split(/\s+/).filter(Boolean);
  const preparing = training.phase === "preparing";
  const complete = training.phase === "result" || (training.family !== "f2l" && Boolean(training.result));
  const virtual = training.mode === "virtual";
  const offTrack = Boolean(progress && !progress.onTrack);
  const done = progress?.onTrack ? progress.index : 0;

  return (
    <div className={`panel ${training.family === "f2l" ? "f2l" : "training"}-setup-panel`}>
      <div className="panel-head">
        <span className="panel-title">Setup</span>
        <nav className="area-switch training-mode-switch" aria-label="Training mode">
          <button
            className={!virtual ? "active" : ""}
            onClick={() => controller.setTrainingMode("setup")}
          >
            Setup cube
          </button>
          <button
            className={virtual ? "active" : ""}
            onClick={() => controller.setTrainingMode("virtual")}
          >
            Virtual case
          </button>
        </nav>
        {preparing && progress && !virtual ? (
          <span className="chip small">{done} / {progress.total}</span>
        ) : null}
      </div>
      <div className="panel-body">
        <div className="small dim f2l-mode-description">
          {virtual
            ? "Use the smart cube only for turns. Its real piece state is ignored."
            : "Match the real cube to the case before solving."}
        </div>
        {!training.target ? (
          <div className="empty">
            {virtual ? "Choose a case to load it virtually." : "Choose a case to guide the cube into position."}
          </div>
        ) : virtual ? (
          complete ? (
            <div className="training-ready" role="status">
              <strong>Complete</strong>
              <span className="small faint">Choose Again to repeat this setup.</span>
            </div>
          ) : training.phase === "solving" ? (
            <div className="training-solving" role="status">
              <strong>Solving</strong>
              <span className="mono">{training.liveMoves.length} turns</span>
            </div>
          ) : (
            <div className="training-ready" role="status">
              <strong>Ready</strong>
              <span className="small faint">The case is loaded virtually. Make one turn to start.</span>
            </div>
          )
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
        ) : training.phase === "ready" && !complete ? (
          <div className="training-ready" role="status">
            <strong>Ready</strong>
            <span className="small faint">Make one turn to start the attempt.</span>
          </div>
        ) : training.phase === "solving" ? (
          <div className="training-solving" role="status">
            <strong>Solving</strong>
            <span className="mono">{training.liveMoves.length} turns</span>
          </div>
        ) : complete ? (
          <div className="training-ready" role="status">
            <strong>Complete</strong>
            <span className="small faint">{training.family === "f2l" ? "Choose Again, or turn D four times, to repeat this setup." : "Choose Again to repeat."}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TrainingReferences() {
  const training = useTrainingState();
  const target = training.target;
  const references = target?.references ?? [];
  const result = training.family === "f2l" ? null : training.result;
  const [showAlternatives, setShowAlternatives] = useState(false);
  const reference = result
    ? result.recommendedAlg === null ? null : { alg: result.recommendedAlg, stm: result.recommendedStm }
    : references[0];
  useEffect(() => { setShowAlternatives(false); }, [target]);

  return (
    <div className="f2l-reference">
      <div className="result-context-label">RECOMMENDED</div>
      {reference ? (
        <>
          <div className="row">
            <strong>{reference.stm} STM</strong>
            {!result && target?.family === "f2l" ? <span className="phase-case">{target.references[0]?.caseName}</span> : null}
          </div>
          <TrainingAlgorithmGuide algorithm={reference.alg} guide={result ? null : training.guide} active={(training.phase === "ready" || training.phase === "solving") && !training.result} />
          {!result && references.length > 1 ? (
            <>
              <button
                className="ghost small"
                onClick={() => setShowAlternatives((shown) => !shown)}
              >
                {showAlternatives ? "Hide alternatives" : `Show ${references.length - 1} alternatives`}
              </button>
              {showAlternatives ? (
                <div className="f2l-alternatives">
                  {references.slice(1).map((alternative) => (
                    <div key={`${alternative.rank}-${alternative.alg}`} className="f2l-alternative">
                      <div className="row">
                        <strong>#{alternative.rank}</strong>
                        <span className="small faint">{alternative.stm} STM</span>
                      </div>
                      <div className="mono f2l-reference-alg">{alternative.alg}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <div className="small faint">No validated reference for this exact target.</div>
      )}
    </div>
  );
}

export function TrainingAttemptResult({
  result,
  phase,
  liveMoveCount,
  elapsed,
}: {
  result: TrainingState["result"];
  phase: TrainingState["phase"];
  liveMoveCount: number;
  elapsed: number;
}) {
  if (result) {
    const description = result.matchedReferenceRank === 1
      ? "Recommended solution"
      : result.matchedReferenceRank
        ? `Known alternative #${result.matchedReferenceRank}`
        : "Valid custom solution";
    const { delta } = result;
    return (
      <div className="f2l-result-card">
        <div className="result-context-label">ATTEMPT</div>
        <div className="f2l-result-stm mono">{result.stm} STM</div>
        <div className="small">{description}</div>
        {delta !== null && delta !== undefined ? (
          <div className={`f2l-delta${delta <= 0 ? " good" : ""}`}>
            {delta > 0
              ? `+${delta} STM vs recommended`
              : delta < 0
                ? `${Math.abs(delta)} STM fewer than recommended`
                : "Same STM as recommended"}
          </div>
        ) : null}
        <div className="mono f2l-result-moves">{result.moves.join(" ") || "(no turns)"}</div>
        <div className="small faint">elapsed {formatTime(result.elapsedMs || elapsed)}</div>
      </div>
    );
  }
  return phase === "solving" ? (
    <div className="f2l-live-metric">
      <strong className="mono">{liveMoveCount} turns</strong>
      <span className="small faint">elapsed {formatTime(elapsed)}</span>
    </div>
  ) : null;
}
