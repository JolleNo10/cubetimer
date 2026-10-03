import { useEffect, useMemo, useState } from "react";
import type { LastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { getLastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { buildLastLayerCatalogueTarget, lastLayerCaseCatalogue, lastLayerCaseName, type LastLayerFamily } from "../../../cube/lastLayerTraining";
import { get3x3x3 } from "../../../cube/puzzle";
import { useAppState, useController, useCubeState, useSettings, useTrainingState } from "../../../app/useController";
import { F2LTraining } from "./F2LTraining";
import { LastLayerCaseThumbnail } from "./LastLayerCaseThumbnail";
import type { TrainingEnvironment } from "./TrainingWorkspace";
import { TrainingWorkspace } from "./TrainingWorkspace";

export function Training() {
  const state = { ...useCubeState(), settings: useSettings(), error: useAppState().error };
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

function LastLayerTraining({ state, family }: { state: TrainingEnvironment; family: LastLayerFamily }) {
  return <TrainingWorkspace state={state} library={<LastLayerCaseLibrary state={state} family={family} />}
    details={<LastLayerTargetDetails family={family} />} emptyMessage={<>Select a {family.toUpperCase()} case.</>} />;
}

function LastLayerCaseLibrary({ state, family }: { state: TrainingEnvironment; family: LastLayerFamily }) {
  const controller = useController();
  const training = useTrainingState();
  const trainingSet = family === "oll" ? state.settings.ollTrainingSet : state.settings.pllTrainingSet;
  const target = training.target && training.target.family === family
    ? training.target
    : null;
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
  );
}

function LastLayerTargetDetails({ family }: { family: LastLayerFamily }) {
  const training = useTrainingState();
  const target = training.target?.family === family ? training.target : null;
  if (!target) return null;
  return <>
    <div className="f2l-target-title"><strong>{lastLayerCaseName(target.family, target.caseId, target.trainingSet)}</strong><span className="phase-case">{target.group}</span></div>
    <div className="small dim f2l-origin">{target.origin.kind === "catalog" ? "Catalogue case" : `From solve · ${target.origin.stepName}`}</div>
  </>;
}
