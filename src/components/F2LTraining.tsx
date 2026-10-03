import { memo, useMemo } from "react";
import { faceColour, slotColours } from "../cube/colours";
import { F2L_POSITIONS, f2lPositionLabel } from "../cube/f2lCases";
import { getF2lThumbnailModel } from "../cube/f2lThumbnail";
import { F2L_TRAINING_CATALOGUES, f2lTrainingCatalogue, shortF2lCaseLabel, type F2lTrainingCase, type F2lTrainingLibrary } from "../cube/f2lTrainingCases";
import { useController, useTrainingState } from "../hooks/useController";
import type { AppState } from "../state/controller";
import { F2lCaseThumbnail } from "./F2lCaseThumbnail";
import { TrainingWorkspace } from "./TrainingWorkspace";

export function F2LTraining({ state }: { state: AppState }) {
  const training = useTrainingState();
  const catalogue = f2lTrainingCatalogue(training.f2lSelection.library);
  return <TrainingWorkspace state={state} library={<F2lLibraryPanel />} details={<F2lTargetDetails />}
    emptyMessage={<>Select one of the {catalogue.cases.length} {catalogue.label} cases, or use Train from a solve review.</>} />;
}

function F2lLibraryPanel() {
  const controller = useController();
  const training = useTrainingState();
  const catalogue = f2lTrainingCatalogue(training.f2lSelection.library);
  const target = training.target?.family === "f2l" ? training.target : null;
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
                className={training.f2lSelection.library === option.library ? "active" : ""}
                aria-pressed={training.f2lSelection.library === option.library}
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
            const selected = training.f2lSelection.position === position;
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
          library={training.f2lSelection.library}
          cases={catalogue.cases}
          selectedPosition={training.f2lSelection.position}
          selectedCaseName={target?.origin.kind === "catalog" && target.origin.library === training.f2lSelection.library
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

function F2lTargetDetails() {
  const training = useTrainingState();
  const target = training.target?.family === "f2l" ? training.target : null;
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
