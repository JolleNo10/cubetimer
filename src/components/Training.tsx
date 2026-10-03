import { useEffect, useMemo, useState } from "react";
import type { LastLayerThumbnailModel } from "../cube/lastLayerThumbnail";
import { getLastLayerThumbnailModel } from "../cube/lastLayerThumbnail";
import { buildLastLayerCatalogueTarget, lastLayerCaseCatalogue, lastLayerCaseName, type LastLayerFamily } from "../cube/lastLayerTraining";
import { get3x3x3 } from "../cube/puzzle";
import { useController, useStore, useTrainingState } from "../hooks/useController";
import type { AppState } from "../state/controller";
import { formatTime } from "../state/stats";
import { ConnectionPanel } from "./ConnectionPanel";
import { CubeView } from "./CubeView";
import { F2LTraining } from "./F2LTraining";
import { LastLayerCaseThumbnail } from "./LastLayerCaseThumbnail";
import { TrainingAlgorithmGuide } from "./TrainingAlgorithmGuide";

export function Training({ state }: { state: AppState }) {
  const controller = useController();
  const family = useTrainingState().family;
  return (
    <div className="training-screen">
      <nav className="training-family-switch area-switch" aria-label="Training family">
        {(["f2l", "oll", "pll"] as const).map((option) => (
          <button
            type="button"
            key={option}
            className={family === option ? "active" : ""}
            aria-pressed={family === option}
            onClick={() => controller.setTrainingFamily(option)}
          >
            {option === "f2l" ? "F2L" : option.toUpperCase()}
          </button>
        ))}
      </nav>
      {family === "f2l" ? <F2LTraining state={state} /> : <LastLayerTraining state={state} family={family} />}
    </div>
  );
}

function LastLayerTraining({ state, family }: { state: AppState; family: LastLayerFamily }) {
  const controller = useController();
  const elapsed = useStore(controller.elapsed);
  const training = useTrainingState();
  const trainingSet = family === "oll" ? state.settings.ollTrainingSet : state.settings.pllTrainingSet;
  const target = training.target && training.target.family === family
    ? training.target
    : null;
  const physicalLive = state.cubeStatus === "connected" || state.virtualCube;
  const displayLive = training.mode === "virtual" ? Boolean(target) : physicalLive;
  const [thumbnailModels, setThumbnailModels] = useState<Map<string, LastLayerThumbnailModel>>(new Map());
  const catalogue = useMemo(() => lastLayerCaseCatalogue(family, trainingSet), [family, trainingSet]);

  useEffect(() => {
    let active = true;
    void get3x3x3().then((kpuzzle) => {
      const models = new Map<string, LastLayerThumbnailModel>();
      for (const item of catalogue) {
        try {
          const built = buildLastLayerCatalogueTarget(kpuzzle, family, item.caseId, 0, trainingSet);
          models.set(item.id, getLastLayerThumbnailModel(family, built.pattern, built.info.trainingRotation, built.info.completionGoal));
        } catch {
          // A malformed generated case should be caught by domain tests; omit only its card here.
        }
      }
      if (active) setThumbnailModels(models);
    });
    return () => { active = false; };
  }, [catalogue, family, trainingSet]);

  const groups = useMemo(() => [...new Set(catalogue.map((item) => item.group))], [catalogue]);

  return (
    <div className="app-body training-layout">
      <div className="column left">
        <ConnectionPanel state={state} />
        <div className="panel training-library">
          <div className="panel-head">
            <span className="panel-title">{trainingSet === "2look" ? "2-Look " : ""}{family.toUpperCase()} cases</span>
            <div className="row wrap"><span className="chip small">{catalogue.length} cases</span><button className="ghost small" onClick={() => controller.randomTrainingCase(family)}>Random case</button></div>
          </div>
          <div className="panel-body">
            {groups.map((sourceGroup) => {
              const cases = catalogue.filter((item) => item.group === sourceGroup);
              return (
                <section className="last-layer-group" key={sourceGroup}>
                  <div className="small faint">{sourceGroup}</div>
                  <div className="last-layer-case-grid">
                    {cases.map((item) => {
                      const caseId = item.caseId;
                      const selected = target?.trainingSet === trainingSet && target.caseId === caseId;
                      return (
                        <button type="button" className={`last-layer-case-button${selected ? " selected" : ""}`} key={item.id} aria-pressed={selected} aria-label={item.id} onClick={() => void controller.selectLastLayerCase(family, caseId)}>
                          {thumbnailModels.get(item.id) ? <LastLayerCaseThumbnail model={thumbnailModels.get(item.id)!} /> : null}
                          <span>{family === "oll" && trainingSet === "full" ? `#${caseId}` : item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      <div className="column">
        {state.error ? <div className="notice error"><span className="grow">{state.error}</span><button className="ghost" onClick={() => controller.dismissError()}>Dismiss</button></div> : null}
        <LastLayerSetupPanel />
        <div className="stage training-stage">
          <CubeView
            settings={state.settings}
            facelets={state.cubeFacelets}
            gyroSupported={state.hardware?.gyroSupported ?? false}
            live={displayLive}
            scramble=""
            displayFacelets={training.displayFacelets || state.cubeFacelets}
            displayRevision={training.displayRevision}
            displaySource={training.mode === "virtual" ? "virtual" : "physical"}
            orientationOverride={target?.trainingRotation.orientation}
            physicalSyncAvailable={state.cubeStatus === "connected"}
            guideMove={target && target.references.length > 0 && (training.phase === "ready" || training.phase === "solving") && !training.result ? training.guide?.currentMove : null}
          />
        </div>
      </div>

      <div className="column right"><LastLayerTargetPanel elapsed={elapsed} family={family} /></div>
    </div>
  );
}

function LastLayerSetupPanel() {
  const controller = useController();
  const training = useTrainingState();
  const progress = training.setupProgress;
  const moves = training.setup.split(/\s+/).filter(Boolean);
  const done = progress?.onTrack ? progress.index : 0;
  const offTrack = Boolean(progress && !progress.onTrack);
  return (
    <div className="panel training-setup-panel">
      <div className="panel-head"><span className="panel-title">Setup</span><nav className="area-switch training-mode-switch" aria-label="Training mode"><button className={training.mode === "setup" ? "active" : ""} onClick={() => void controller.setTrainingMode("setup")}>Setup cube</button><button className={training.mode === "virtual" ? "active" : ""} onClick={() => void controller.setTrainingMode("virtual")}>Virtual case</button></nav>{training.phase === "preparing" && progress ? <span className="chip small">{done} / {progress.total}</span> : null}</div>
      <div className="panel-body">
        <div className="small dim">{training.mode === "virtual" ? "The physical piece state is ignored; turns update the virtual case." : "Match the real cube to the selected case before solving."}</div>
        {!training.target ? <div className="empty">Choose a case to begin.</div> : training.mode === "virtual" ? (
          <div className="training-ready" role="status"><strong>{training.result ? "Complete" : training.phase === "solving" ? "Solving" : "Ready"}</strong><span className="small faint">{training.phase === "solving" ? `${training.liveMoves.length} turns` : "Make one turn to start."}</span></div>
        ) : training.phase === "preparing" ? (
          <><div className="scramble f2l-setup-moves">{moves.length ? moves.map((move, index) => <span key={`${move}-${index}`} className={`scramble-move${index < done ? " done" : ""}${!offTrack && index === done ? " next" : ""}`}>{move}</span>) : <span className="faint">Already at the target.</span>}</div>{progress ? <div className="scramble-progress-track"><div className="scramble-progress-fill" style={{ width: `${progress.total ? done / progress.total * 100 : 100}%`, background: offTrack ? "var(--amber)" : "var(--accent)" }} /></div> : null}{offTrack ? <div className="notice"><b>Off the setup.</b> {training.recovery?.alg ?? "Turn back toward the target, or re-read the cube."}<div className="row"><button onClick={() => void controller.syncFromCube()}>Re-read cube</button></div></div> : null}</>
        ) : training.phase === "ready" && !training.result ? <div className="training-ready" role="status"><strong>Ready</strong><span className="small faint">Make one turn to start the attempt.</span></div> : training.phase === "solving" ? <div className="training-solving" role="status"><strong>Solving</strong><span className="mono">{training.liveMoves.length} turns</span></div> : <div className="training-ready" role="status"><strong>Complete</strong><span className="small faint">Choose Again to repeat.</span></div>}
      </div>
    </div>
  );
}

function LastLayerTargetPanel({ elapsed, family }: { elapsed: number; family: LastLayerFamily }) {
  const controller = useController();
  const training = useTrainingState();
  const [showAlternatives, setShowAlternatives] = useState(false);
  const target = training.target && training.target.family === family
    ? training.target
    : null;
  const result = training.result;
  const reference = result
    ? result.recommendedAlg === null ? null : { alg: result.recommendedAlg, stm: result.recommendedStm }
    : target?.references[0];

  useEffect(() => {
    setShowAlternatives(false);
  }, [target]);

  return (
    <div className="panel training-target-panel">
      <div className="panel-head"><span className="panel-title">Training target</span>{result ? <span className="chip live">result</span> : null}</div>
      <div className="panel-body">
        {!target ? <div className="empty">Select a {family.toUpperCase()} case.</div> : <>
          <div className="f2l-target-title"><strong>{lastLayerCaseName(target.family, target.caseId, target.trainingSet)}</strong><span className="phase-case">{target.group}</span></div>
          <div className="small dim f2l-origin">{target.origin.kind === "catalog" ? "Catalogue case" : `From solve · ${target.origin.stepName}`}</div>
          <div className="f2l-reference"><div className="result-context-label">RECOMMENDED</div>{reference ? <>
            <div className="row"><strong>{reference.stm} STM</strong></div>
            <TrainingAlgorithmGuide algorithm={reference.alg} guide={result ? null : training.guide} active={(training.phase === "ready" || training.phase === "solving") && !result} />
            {!result && target.references.length > 1 ? <><button type="button" className="ghost small" onClick={() => setShowAlternatives((shown) => !shown)}>{showAlternatives ? "Hide alternatives" : `Show ${target.references.length - 1} alternatives`}</button>{showAlternatives ? <div className="f2l-alternatives">{target.references.slice(1).map((alternative) => <div key={`${alternative.rank}-${alternative.alg}`} className="f2l-alternative"><div className="row"><strong>#{alternative.rank}</strong><span className="small faint">{alternative.stm} STM</span></div><div className="mono f2l-reference-alg">{alternative.alg}</div></div>)}</div> : null}</> : null}
          </> : <div className="small faint">No validated reference for this exact target.</div>}</div>
          {result ? <div className="f2l-result-card"><div className="result-context-label">ATTEMPT</div><div className="f2l-result-stm mono">{result.stm} STM</div><div className="small">{result.matchedReferenceRank === 1 ? "Recommended solution" : result.matchedReferenceRank ? `Known alternative #${result.matchedReferenceRank}` : "Valid custom solution"}</div>{result.delta !== null ? <div className="f2l-delta">{result.delta > 0 ? `+${result.delta} STM vs recommended` : result.delta < 0 ? `${Math.abs(result.delta)} STM fewer than recommended` : "Same STM as recommended"}</div> : null}<div className="mono f2l-result-moves">{result.moves.join(" ") || "(no turns)"}</div><div className="small faint">elapsed {formatTime(result.elapsedMs || elapsed)}</div></div> : training.phase === "solving" ? <div className="f2l-live-metric"><strong className="mono">{training.liveMoves.length} turns</strong><span className="small faint">elapsed {formatTime(elapsed)}</span></div> : null}
          <div className="row wrap f2l-actions">{training.result ? <button className="primary" onClick={() => controller.againTraining()}>Again</button> : null}<button className="ghost" onClick={() => controller.resetTraining()}>Clear case</button></div>
        </>}
      </div>
    </div>
  );
}
