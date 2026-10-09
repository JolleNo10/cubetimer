import { recognitionStatsByCase } from "../trainingRecognitionPerformance";
import { trainingCatalogueKey } from "../../../app/trainingCatalogue";
import { TrainingMyAlgorithmMarker } from "./TrainingAlgorithmEditor";
import { memo, useMemo } from "react";
import { faceColour, slotColours } from "../../../cube/colours";
import { F2L_POSITIONS, f2lPositionLabel } from "../../../cube/f2lCases";
import { getF2lThumbnailModel } from "../../../cube/f2lThumbnail";
import { F2L_TRAINING_CATALOGUES, f2lTrainingCatalogue, shortF2lCaseLabel, type F2lTrainingCase, type F2lTrainingLibrary } from "../../../cube/f2lTrainingCases";
import { useController, useStore, useStoreValue } from "../../../app/useController";
import { F2lCaseThumbnail } from "../../../shared/ui/F2lCaseThumbnail";
import { TrainingWorkspace } from "./TrainingWorkspace";
import { trainingCaseKey, trainingStatsByCase, type TrainingCaseStats } from "../trainingPerformance";
import { DrillPoolActions } from "./TrainingDrill";
import { TrainingCaseMarker, trainingPerformanceLabel } from "./TrainingPerformance";

export function F2LTraining() {
  const controller = useController();
  const library = useStoreValue(controller.training.state, state => state.f2lSelection.library);
  const catalogue = f2lTrainingCatalogue(library);
  return <TrainingWorkspace library={<F2lLibraryPanel />} details={<F2lTargetDetails />}
    emptyMessage={<>Select one of the {catalogue.cases.length} {catalogue.label} cases, or use Train from a solve review.</>} />;
}

function F2lLibraryPanel() {
  const controller = useController();
  const selection = useStoreValue(controller.training.state, state => state.f2lSelection);
  const selectedTarget = useStoreValue(controller.training.state, state => state.target);
  const activity = useStoreValue(controller.training.state, state => state.activity);
  const drill = useStoreValue(controller.training.state, state => state.drill);
  const catalogue = f2lTrainingCatalogue(selection.library);
  const preferences = useStore(controller.trainingAlgorithmPreferences);
  const preferredKeys = useMemo(() => new Set(preferences.map(p => p.key)), [preferences]);
  const attempts = useStore(controller.trainingAttempts);
  const recognitionAttempts = useStore(controller.trainingRecognitionAttempts);
  const statsByCase = useMemo(() => activity === "drill" && drill.task === "recognition"
    ? recognitionStatsByCase(recognitionAttempts) : trainingStatsByCase(attempts), [activity, drill.task, recognitionAttempts, attempts]);
  const target = selectedTarget?.family === "f2l" ? selectedTarget : null;
  return (
    <div className="panel f2l-library">
      <div className="panel-head">
        <span className="panel-title">F2L cases</span>
        <div className="f2l-library-controls">
          <nav className="area-switch f2l-library-switch" aria-label="F2L case library">
            {Object.values(F2L_TRAINING_CATALOGUES).map((option) => (
              <button
                type="button"
                key={option.library}
                className={selection.library === option.library ? "active" : ""}
                aria-pressed={selection.library === option.library}
                disabled={drill.status !== "configuring"}
                onClick={() => controller.setF2lLibrary(option.library)}
              >
                {option.label}
              </button>
            ))}
          </nav>
          <span className="chip small">{catalogue.cases.length} cases</span>
          {activity === "single" ? <><button className="ghost small" onClick={() => controller.randomTrainingCase("f2l")}>Random case</button>
          <button className="ghost small" onClick={() => void controller.reviewTrainingCase("f2l")}>Review next</button></> :
            <DrillPoolActions caseIds={catalogue.cases.map(c => c.name)} />}
        </div>
      </div>
      <div className="panel-body">
        <div className="small faint">Train the pair in your current grip:</div>
        <nav className="f2l-position-switch" aria-label="F2L position">
          {F2L_POSITIONS.map((position) => {
            const fixed = target?.origin.kind === "solve-step";
            const selected = selection.position === position;
            return (
              <button
                type="button"
                key={position}
                className={selected ? "active" : ""}
                aria-pressed={selected}
                disabled={fixed || drill.status !== "configuring"}
                onClick={() => void controller.selectF2lPosition(position)}
              >
                {f2lPositionLabel(position)}
              </button>
            );
          })}
        </nav>
        <F2lCaseLibrary
          library={selection.library}
          cases={catalogue.cases}
          selectedPosition={selection.position}
          statsByCase={statsByCase}
          preferredKeys={preferredKeys}
          selectedCaseName={target?.origin.kind === "catalog" && target.origin.library === selection.library
            ? target.origin.caseName
            : null}
        />
      </div>
    </div>
  );
}

const F2lCaseLibrary = memo(function F2lCaseLibrary({
  library,
  cases,
  selectedPosition,
  selectedCaseName,
  statsByCase,
  preferredKeys,
}: {
  library: F2lTrainingLibrary;
  cases: readonly F2lTrainingCase[];
  selectedPosition: (typeof F2L_POSITIONS)[number];
  selectedCaseName: string | null;
  statsByCase: ReadonlyMap<string, Pick<TrainingCaseStats, "attempts" | "status">>;
  preferredKeys: ReadonlySet<string>;
}) {
  const controller = useController();
  const activity = useStoreValue(controller.training.state, state => state.activity);
  const drill = useStoreValue(controller.training.state, state => state.drill);
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
              const selected = activity === "drill" ? drill.selectedCaseIds.includes(f2lCase.name) : selectedCaseName === f2lCase.name;
              const model = thumbnailModels.get(f2lCase.name);
              const stats = statsByCase.get(trainingCaseKey({ family: "f2l", origin: "catalog", library, caseName: f2lCase.name, position: selectedPosition })!);
              const performance = trainingPerformanceLabel(stats);
              return (
                <button
                  type="button"
                  key={f2lCase.name}
                  className={`f2l-case-button${selected ? " selected" : ""}`}
                  aria-label={`${f2lCase.name}, ${f2lPositionLabel(selectedPosition)}${performance ? `, ${performance}` : ""}`}
                  aria-pressed={selected}
                  disabled={drill.status !== "configuring"}
                  onClick={() => activity === "drill" ? controller.toggleDrillCase(f2lCase.name) : void controller.selectF2lCase(f2lCase.name)}
                >
                  {model ? <F2lCaseThumbnail
                    model={model}
                  /> : null}
                  <span className="f2l-case-number">{shortF2lCaseLabel(f2lCase.name)}</span>
                  {activity === "drill" && selected ? <span className="drill-pool-marker">✓ Selected</span> : null}
                  {preferredKeys.has(trainingCatalogueKey({ family: "f2l", library, caseName: f2lCase.name, position: selectedPosition })) ? <TrainingMyAlgorithmMarker /> : null}
                  <TrainingCaseMarker stats={stats} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
});

function F2lTargetDetails() {
  const controller = useController();
  const selectedTarget = useStoreValue(controller.training.state, state => state.target);
  const target = selectedTarget?.family === "f2l" ? selectedTarget : null;
  if (!target) return null;
  const reference = target.references[0];
  const slotName = slotColours(target.slot) ?? target.slot;
  return <>
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
  </>;
}
