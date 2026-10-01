import { memo, useMemo, useState } from "react";
import { useController, useStore } from "../hooks/useController";
import { F2L_POSITIONS, f2lPositionLabel } from "../cube/f2lCases";
import { F2L_TRAINING_CATALOGUES, f2lTrainingCatalogue, shortF2lCaseLabel, type F2lTrainingCase, type F2lTrainingLibrary } from "../cube/f2lTrainingCases";
import { faceColour, slotColours } from "../cube/colours";
import { f2lTrainingGrip, type F2lReference } from "../cube/f2lTraining";
import { getF2lThumbnailModel } from "../cube/f2lThumbnail";
import { formatTime } from "../state/stats";
import type { AppState } from "../state/controller";
import { ConnectionPanel } from "./ConnectionPanel";
import { CubeView } from "./CubeView";
import { F2lCaseThumbnail } from "./F2lCaseThumbnail";

export function F2LTraining({ state }: { state: AppState }) {
  const controller = useController();
  const elapsed = useStore(controller.elapsed);
  const training = state.f2lTraining;
  const catalogue = f2lTrainingCatalogue(training.selectedLibrary);
  const target = training.target;
  const physicalLive = state.cubeStatus === "connected" || state.virtualCube;
  const displayLive = training.mode === "virtual" ? Boolean(target) : physicalLive;
  const orientationOverride = useMemo(
    () => (target ? f2lTrainingGrip(target) : undefined),
    [target],
  );

  return (
    <div className="app-body f2l-training-layout">
      <div className="column left">
        <ConnectionPanel state={state} />
        <div className="panel f2l-library">
          <div className="panel-head">
            <span className="panel-title">F2L cases</span>
            <div className="f2l-library-controls">
              <nav className="area-switch f2l-library-switch" aria-label="F2L case library">
                {Object.values(F2L_TRAINING_CATALOGUES).map((option) => (
                  <button
                    type="button"
                    key={option.library}
                    className={training.selectedLibrary === option.library ? "active" : ""}
                    aria-pressed={training.selectedLibrary === option.library}
                    onClick={() => controller.setF2lLibrary(option.library)}
                  >
                    {option.label}
                  </button>
                ))}
              </nav>
              <span className="chip small">{catalogue.cases.length} cases</span>
            </div>
          </div>
          <div className="panel-body">
            <div className="small faint">Train the pair in your current grip:</div>
            <nav className="f2l-position-switch" aria-label="F2L position">
              {F2L_POSITIONS.map((position) => {
                const fixed = target?.origin.kind === "solve-step";
                const selected = training.selectedPosition === position;
                return (
                  <button
                    type="button"
                    key={position}
                    className={selected ? "active" : ""}
                    aria-pressed={selected}
                    disabled={fixed}
                    onClick={() => void controller.selectF2lPosition(position)}
                  >
                    {f2lPositionLabel(position)}
                  </button>
                );
              })}
            </nav>
            <F2lCaseLibrary
              library={training.selectedLibrary}
              cases={catalogue.cases}
              selectedPosition={training.selectedPosition}
              selectedCaseName={target?.origin.kind === "catalog" && target.origin.library === training.selectedLibrary
                ? target.origin.caseName
                : null}
            />
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
            live={displayLive}
            scramble=""
            displayFacelets={training.displayFacelets || state.cubeFacelets}
            displayRevision={training.displayRevision}
            displaySource={training.mode === "virtual" ? "virtual" : "physical"}
            orientationOverride={orientationOverride}
            physicalSyncAvailable={state.cubeStatus === "connected"}
          />
        </div>
      </div>

      <div className="column right">
        <TargetPanel state={state} elapsed={elapsed} />
      </div>
    </div>
  );
}

const F2lCaseLibrary = memo(function F2lCaseLibrary({
  library,
  cases,
  selectedPosition,
  selectedCaseName,
}: {
  library: F2lTrainingLibrary;
  cases: readonly F2lTrainingCase[];
  selectedPosition: (typeof F2L_POSITIONS)[number];
  selectedCaseName: string | null;
}) {
  const controller = useController();
  const groups = useMemo(() => [...new Set(cases.map((f2lCase) => f2lCase.group))], [cases]);
  const thumbnailModels = useMemo(
    () => new Map(cases.map((f2lCase) => [f2lCase.name, getF2lThumbnailModel(library, f2lCase.name, selectedPosition)])),
    [cases, library, selectedPosition],
  );

  return (
    <>
      {groups.map((group) => (
        <section className="f2l-group" key={group}>
          <div className="small faint">{group}</div>
          <div className="f2l-case-grid">
            {cases.filter((f2lCase) => f2lCase.group === group).map((f2lCase) => {
              const selected = selectedCaseName === f2lCase.name;
              const model = thumbnailModels.get(f2lCase.name);
              return (
                <button
                  type="button"
                  key={f2lCase.name}
                  className={`f2l-case-button${selected ? " selected" : ""}`}
                  aria-label={`${f2lCase.name}, ${f2lPositionLabel(selectedPosition)}`}
                  aria-pressed={selected}
                  onClick={() => void controller.selectF2lCase(f2lCase.name)}
                >
                  {model ? <F2lCaseThumbnail
                    model={model}
                    view={library === "advanced" ? "advanced" : "basic"}
                  /> : null}
                  <span className="f2l-case-number">{shortF2lCaseLabel(f2lCase.name)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
});

function SetupPanel({ state }: { state: AppState }) {
  const controller = useController();
  const training = state.f2lTraining;
  const progress = training.setupProgress;
  const moves = training.setup.split(/\s+/).filter(Boolean);
  const preparing = training.phase === "preparing";
  const virtual = training.mode === "virtual";
  const offTrack = Boolean(progress && !progress.onTrack);
  const done = progress?.onTrack ? progress.index : 0;

  return (
    <div className="panel f2l-setup-panel">
      <div className="panel-head">
        <span className="panel-title">Setup</span>
        <nav className="area-switch f2l-mode-switch" aria-label="Smart cube mode">
          <button
            className={!virtual ? "active" : ""}
            onClick={() => controller.setF2lMode("setup")}
          >
            Setup cube
          </button>
          <button
            className={virtual ? "active" : ""}
            onClick={() => controller.setF2lMode("virtual")}
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
          training.phase === "result" ? (
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
        ) : training.phase === "ready" ? (
          <div className="training-ready" role="status">
            <strong>Ready</strong>
            <span className="small faint">Make one turn to start the attempt.</span>
          </div>
        ) : training.phase === "solving" ? (
          <div className="training-solving" role="status">
            <strong>Solving</strong>
            <span className="mono">{training.liveMoves.length} turns</span>
          </div>
        ) : training.phase === "result" ? (
          <div className="training-ready" role="status">
            <strong>Complete</strong>
            <span className="small faint">Choose Again, or turn D four times, to repeat this setup.</span>
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
  const references = target?.references ?? [];
  const reference = references[0];
  const slotName = target ? slotColours(target.slot) ?? target.slot : null;

  return (
    <div className="panel f2l-target-panel">
      <div className="panel-head">
        <span className="panel-title">Training target</span>
        {result ? <span className="chip live">result</span> : null}
      </div>
      <div className="panel-body">
        {!target ? (
          <div className="empty">Select one of the {f2lTrainingCatalogue(training.selectedLibrary).cases.length} {f2lTrainingCatalogue(training.selectedLibrary).label} cases, or use Train from a solve review.</div>
        ) : (
          <>
            <div className="f2l-target-title">
              <strong>{reference?.caseName ?? (target.origin.kind === "catalog" ? target.origin.caseName : "Exact F2L setup")}</strong>
              {reference?.group ? <span className="phase-case">{reference.group}</span> : null}
            </div>
            <div className="small dim f2l-origin">
              {target.origin.kind === "catalog"
                ? `${f2lTrainingCatalogue(target.origin.library).label} F2L · ${f2lPositionLabel(target.position)}`
                : `From solve · ${target.origin.stepName} · ${slotName ?? target.origin.slot}`}
            </div>
            <div className="f2l-target-facts">
              <span>
                cross <b><i className="colour-dot" style={{ background: faceColour(target.crossFace).hex }} />{faceColour(target.crossFace).name}</b>
              </span>
              <span>position <b>{f2lPositionLabel(target.position)}</b></span>
              <span>slot <b>{slotName}</b></span>
              {target.protectedSlots.length > 0 ? (
                <span>protected <b>{target.protectedSlots.map((slot) => slotColours(slot) ?? slot).join(", ")}</b></span>
              ) : null}
            </div>

            <ReferenceSection references={references} />
            <AttemptSection
              result={result}
              phase={training.phase}
              liveMoveCount={training.liveMoves.length}
              elapsed={elapsed}
            />

            <div className="row wrap f2l-actions">
              {training.phase === "result" ? (
                <button className="primary" onClick={() => controller.againF2lTraining()}>
                  Again
                </button>
              ) : null}
              <button className="ghost" onClick={() => controller.resetF2lTraining()}>
                Clear case
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReferenceSection({ references }: { references: readonly F2lReference[] }) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const reference = references[0];

  return (
    <div className="f2l-reference">
      <div className="result-context-label">RECOMMENDED</div>
      {reference ? (
        <>
          <div className="row">
            <strong>{reference.stm} STM</strong>
            <span className="phase-case">{reference.caseName}</span>
          </div>
          <div className="mono f2l-reference-alg">{reference.alg}</div>
          {references.length > 1 ? (
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
        <div className="small faint">No valid standard reference for this exact setup.</div>
      )}
    </div>
  );
}

function AttemptSection({
  result,
  phase,
  liveMoveCount,
  elapsed,
}: {
  result: AppState["f2lTraining"]["result"];
  phase: AppState["f2lTraining"]["phase"];
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
