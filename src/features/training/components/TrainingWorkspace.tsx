import { catalogueIdentityForTarget, trainingCatalogueKey } from "../../../app/trainingCatalogue";
import { TrainingAlgorithmEditor } from "./TrainingAlgorithmEditor";
import { formatTime } from "../../../shared/time";
import { useEffect, useState, type ReactNode } from "react";
import { useController, useSettings, useStore, useStoreValue, useTrainingState } from "../../../app/useController";
import { concealsTrainingAnswer, type TrainingState } from "../TrainingRuntime";
import type { MoveGuide } from "../../../cube/moveGuide";
import type { TrainingGuideProgress } from "../../../cube/training";

import { CubeView } from "../../../shared/ui/CubeView";
import { TrainingAlgorithmGuide, type TrainingGuideNavigation } from "./TrainingAlgorithmGuide";
import { DrillCountdown, TrainingDrillPanel, TrainingDrillControls, TrainingDrillSummary } from "./TrainingDrill";
import { TrainingRecognition } from "./TrainingRecognition";
import { TrainingPersonalPerformance } from "./TrainingPerformance";

export type TrainingStepPreview = {
  index: number;
  move: MoveGuide;
  facelets: string;
};

export function TrainingWorkspace({ library, details, emptyMessage }: {
  library: ReactNode; details: ReactNode; emptyMessage: ReactNode;
}) {
  const controller = useController();
  const family = useStoreValue(controller.training.state, state => state.family);
  const activity = useStoreValue(controller.training.state, state => state.activity);
  const drill = useStoreValue(controller.training.state, state => state.drill);
  const error = useStoreValue(controller.state, state => state.error);
  const target = useStoreValue(controller.training.state, state => state.target);
  const guide = useStoreValue(controller.training.state, state => state.guide);
  const [preview, setPreview] = useState<{
    index: number; target: TrainingState["target"]; guide: TrainingGuideProgress;
  } | null>(null);
  // Scope the selection to this guide/progress even before the reset effect runs.
  const previewIndex = preview && preview.target === target && preview.guide === guide ? preview.index : null;
  useEffect(() => { setPreview(null); }, [target, guide]);
  const onPreviewStep = (index: number | null) => setPreview(
    index === null || !guide || index === guide.confirmed ? null : { index, target, guide });
  const stepPreview = previewIndex === null || !guide ? undefined : {
    index: previewIndex, move: guide.guideMoves[previewIndex], facelets: guide.checkpointFacelets[previewIndex],
  };
  const f2l = family === "f2l";
  return (
    <div className={`app-body ${f2l ? "f2l-training" : "training"}-layout${drill.running ? " drill-running-layout" : drill.status === "summary" ? " drill-summary-layout" : ""}`}>
      <div className="column left training-library-column">{drill.running ? <TrainingDrillPanel /> : library}</div>
      <div className="column training-workspace-column">
        {error ? <div className="notice error"><span className="grow">{error}</span><button className="ghost" onClick={() => controller.dismissError()}>Dismiss</button></div> : null}
        {drill.status === "summary" ? <TrainingDrillSummary /> : <>
          {activity === "drill" ? drill.running ? <TrainingDrillControls /> : <TrainingDrillPanel /> : <TrainingSetupPanel />}
          <TrainingCubeStage preview={stepPreview} />
        </>}
      </div>
      <div className="column right training-target-column">
        {drill.status !== "summary" ? <TrainingTargetPanel details={details} emptyMessage={emptyMessage} previewIndex={previewIndex} onPreviewStep={onPreviewStep} /> : null}
      </div>
    </div>
  );
}

function TrainingTargetPanel({ details, emptyMessage, previewIndex, onPreviewStep }: { details: ReactNode; emptyMessage: ReactNode } & TrainingGuideNavigation) {
  const controller = useController();
  const family = useStoreValue(controller.training.state, state => state.family);
  const target = useStoreValue(controller.training.state, state => state.target);
  const result = useStoreValue(controller.training.state, state => state.result);
  const training = useTrainingState();
  const concealed = concealsTrainingAnswer(training);
  const f2l = family === "f2l";
  return (
    <div className={`panel ${f2l ? "f2l" : "training"}-target-panel`}>
      <div className="panel-head"><span className="panel-title">Training target</span>{result ? <span className="chip live">result</span> : null}</div>
      <div className="panel-body">
        {!target ? <div className="empty">{training.activity === "drill" ? "Select cases and start a drill." : emptyMessage}</div> : concealed ? <>
          {training.drill.task === "recognition" ? <TrainingRecognition /> : <><div className="small dim">Recognize and solve the cube case.</div><TrainingAttempt /></>}
        </> : <>
          {training.drill.lastOutcome === "skipped" ? <div className="chip">Skipped</div> : null}
          <TrainingRecognition />
          {details}
          <TrainingPersonalPerformance />
          <TrainingReferences previewIndex={previewIndex} onPreviewStep={onPreviewStep} />
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
  return <TrainingAttemptResult result={training.result} phase={training.phase} liveMoveCount={training.liveMoves.length} elapsed={elapsed} activity={training.activity} />;
}

export function TrainingCubeStage({ preview }: { preview?: TrainingStepPreview } = {}) {
  const controller = useController();
  const settings = useSettings();
  const cubeFacelets = useStoreValue(controller.physical.state, state => state.cubeFacelets);
  const gyroSupported = useStoreValue(controller.physical.state, state => state.hardware?.gyroSupported ?? false);
  const cubeStatus = useStoreValue(controller.physical.state, state => state.cubeStatus);
  const virtualCube = useStoreValue(controller.physical.state, state => state.virtualCube);
  const training = useTrainingState();
  const target = training.target;
  const physicalLive = cubeStatus === "connected" || virtualCube;
  const guideActive = Boolean(training.activity === "single" && target && target.references.length > 0 && (training.phase === "ready" || training.phase === "solving") && !training.result);
  const viewed = guideActive ? preview : undefined;
  if (training.activity === "drill" && !target) return <div className="stage training-stage drill-concealed-stage" aria-label="Drill cube area">
    {training.drill.running ? <DrillCountdown initial /> : <div className="empty">Select cases to practise in a virtual drill.</div>}
  </div>;
  return <div className={`stage ${training.family === "f2l" ? "f2l" : "training"}-stage`}>
    <CubeView settings={settings} facelets={cubeFacelets} gyroSupported={gyroSupported}
      live={training.mode === "virtual" ? Boolean(target) : physicalLive} scramble=""
      displayFacelets={viewed?.facelets ?? (training.displayFacelets || cubeFacelets)}
      displayRevision={`${training.displayRevision}:${viewed ? `preview:${viewed.index}` : "live"}`} staticDisplay={Boolean(viewed)}
      displaySource={training.mode === "virtual" ? "virtual" : "physical"} orientationOverride={target?.trainingRotation.orientation}
      physicalSyncAvailable={cubeStatus === "connected"}
      guideMove={guideActive ? viewed?.move ?? training.guide?.currentMove : null} />
  </div>;
}

export function TrainingActions() {
  const controller = useController();
  const training = useTrainingState();
  if (training.activity === "drill") return null;
  const again = Boolean(training.result);
  return <div className="row wrap f2l-actions">
    {again ? <button className="primary" onClick={() => controller.againTraining()}>Again</button> : null}
    {again && training.target?.origin.kind === "catalog" ? <button onClick={() => void controller.reviewTrainingCase(training.family)}>Next review</button> : null}
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

export function TrainingReferences({ previewIndex, onPreviewStep }: TrainingGuideNavigation = {}) {
  const controller = useController();
  const training = useTrainingState();
  const preferences = useStore(controller.trainingAlgorithmPreferences);
  const target = training.target, references = target?.references ?? [];
  const identity = catalogueIdentityForTarget(target);
  const preference = identity ? preferences.find(p => p.key === trainingCatalogueKey(identity)) ?? null : null;
  const preferred = training.preferredReference;
  const canManage = training.activity === "single" && training.phase !== "solving" && Boolean(identity);
  const result = training.activity === "drill" || training.family === "f2l" ? null : training.result;
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = canManage && !busy;
  const [error, setError] = useState<string | null>(null);
  const reference = result
    ? result.recommendedAlg === null ? null : { alg: result.recommendedAlg, stm: result.recommendedStm }
    : references[0];
  useEffect(() => { setShowAlternatives(false); setError(null); }, [target]);
  if (concealsTrainingAnswer(training)) return null;
  const useAsMine = async (sourceAlg: string) => {
    setBusy(true); setError(null);
    try {
      const response = await controller.useCanonicalTrainingAlgorithm(sourceAlg);
      if (!response.success) setError(response.error ?? "Could not save My algorithm.");
    } finally { setBusy(false); }
  };
  const guideActive = (training.phase === "ready" || training.phase === "solving") && !training.result;
  return <div className="f2l-reference">
    {preference ? <section className="training-my-algorithm" aria-label="My algorithm">
      <div className="result-context-label">MY ALGORITHM <span aria-label="Personal algorithm">★</span></div>
      {preferred ? <>
        <strong>{preferred.stm} STM</strong>
        <TrainingAlgorithmGuide algorithm={preferred.alg} label="My algorithm" guide={training.guide}
          active={guideActive} previewIndex={previewIndex} onPreviewStep={onPreviewStep} />
      </> : <><div className="mono f2l-reference-alg">{preference.algorithm}</div>
        <p className="small dim">This saved algorithm needs editing for the current catalogue. Training uses Recommended.</p></>}
      {preference.note ? <p className="small training-algorithm-note">{preference.note}</p> : null}
      {canManage && identity ? <TrainingAlgorithmEditor key={trainingCatalogueKey(identity)} identity={identity} preference={preference} canEdit={canEdit} /> : null}
    </section> : null}
    <div className="result-context-label">RECOMMENDED</div>
    {reference ? <>
      <div className="row wrap"><strong>{reference.stm} STM</strong>
        {!result && target?.family === "f2l" ? <span className="phase-case">{target.references[0]?.caseName}</span> : null}
      </div>
      <TrainingAlgorithmGuide algorithm={reference.alg} guide={preferred || result ? null : training.guide}
        active={!preferred && guideActive} previewIndex={previewIndex} onPreviewStep={onPreviewStep} />
      {canManage && references[0] ? <button type="button" className="ghost small" disabled={!canEdit}
        onClick={() => void useAsMine(references[0].sourceAlg)}>Use as mine</button> : null}
      {!preference && canManage && identity ? <TrainingAlgorithmEditor key={trainingCatalogueKey(identity)} identity={identity} preference={null} canEdit={canEdit} /> : null}
      {!result && references.length > 1 ? <>
        <button className="ghost small" onClick={() => setShowAlternatives(shown => !shown)}>
          {showAlternatives ? "Hide alternatives" : `Show ${references.length - 1} ${references.length === 2 ? "alternative" : "alternatives"}`}
        </button>
        {showAlternatives ? <div className="f2l-alternatives">{references.slice(1).map(alternative =>
          <div key={`${alternative.rank}-${alternative.alg}`} className="f2l-alternative">
            <div className="row wrap"><strong>#{alternative.rank}</strong><span className="small faint">{alternative.stm} STM</span></div>
            <div className="mono f2l-reference-alg">{alternative.alg}</div>
            {canManage ? <button type="button" className="ghost small" disabled={!canEdit}
              onClick={() => void useAsMine(alternative.sourceAlg)}>Use as mine</button> : null}
          </div>)}</div> : null}
      </> : null}
    </> : <div className="small faint">No validated reference for this exact target.</div>}
    {error ? <p className="small error" role="alert">{error}</p> : null}
  </div>;
}

export function TrainingAttemptResult({
  result,
  phase,
  liveMoveCount,
  elapsed,
  activity = "single",
}: {
  result: TrainingState["result"];
  phase: TrainingState["phase"];
  liveMoveCount: number;
  elapsed: number;
  activity?: TrainingState["activity"];
}) {
  if (result) {
    const description = result.matchedPreferred ? "Matched my algorithm" : result.matchedReferenceRank === 1
      ? "Recommended solution"
      : result.matchedReferenceRank
        ? `Known alternative #${result.matchedReferenceRank}`
        : "Valid custom solution";
    const delta = result.preferredDelta ?? result.delta;
    const benchmark = result.preferredStm != null ? "my algorithm" : "recommended";
    return (
      <div className="f2l-result-card">
        <div className="result-context-label">ATTEMPT</div>
        {result.caseTimeMs != null ? <div className="drill-result-time mono">{formatTime(result.caseTimeMs)} <span className="small">case time</span></div> : null}
        <div className="f2l-result-stm mono">{result.stm} STM</div>
        <div className="small">{description}</div>
        {delta !== null && delta !== undefined ? (
          <div className={`f2l-delta${delta <= 0 ? " good" : ""}`}>
            {delta > 0
              ? `+${delta} STM vs ${benchmark}`
              : delta < 0
                ? `${Math.abs(delta)} STM fewer than ${benchmark}`
                : `Same STM as ${benchmark}`}
          </div>
        ) : null}
        {result.preferredStm != null ? <div className="small dim">My algorithm {result.preferredStm} STM · Recommended {result.recommendedStm ?? "—"} STM</div> : null}
        <div className="mono f2l-result-moves">{result.moves.join(" ") || "(no turns)"}</div>
        <div className="small faint">Move span {formatTime(result.elapsedMs)}</div>
      </div>
    );
  }
  return phase === "solving" ? (
    <div className="f2l-live-metric">
      <strong className="mono">{liveMoveCount} turns</strong>
      <span className="small faint">{activity === "drill" ? "Case time" : "Move span"} {formatTime(elapsed)}</span>
    </div>
  ) : null;
}
