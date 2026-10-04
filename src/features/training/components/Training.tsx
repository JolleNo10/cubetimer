import { useEffect, useMemo, useState } from "react";
import type { LastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { getLastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { buildLastLayerCatalogueTarget, lastLayerCaseCatalogue, lastLayerCaseName, type LastLayerFamily } from "../../../cube/lastLayerTraining";
import { get3x3x3 } from "../../../cube/puzzle";
import { useController, useStore, useStoreValue } from "../../../app/useController";
import { F2LTraining } from "./F2LTraining";
import { LastLayerCaseThumbnail } from "./LastLayerCaseThumbnail";
import { TrainingWorkspace } from "./TrainingWorkspace";
import { trainingCaseKey, trainingStatsByCase } from "../trainingPerformance";
import { TrainingCaseMarker, trainingPerformanceLabel } from "./TrainingPerformance";

export function Training() {
  const controller = useController();
  const family = useStoreValue(controller.training.state, state => state.family);
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
      {family === "f2l" ? <F2LTraining /> : <LastLayerTraining family={family} />}
    </div>
  );
}

function LastLayerTraining({ family }: { family: LastLayerFamily }) {
  return <TrainingWorkspace library={<LastLayerCaseLibrary family={family} />}
    details={<LastLayerTargetDetails family={family} />} emptyMessage={<>Select a {family.toUpperCase()} case.</>} />;
}

function LastLayerCaseLibrary({ family }: { family: LastLayerFamily }) {
  const controller = useController();
  const selectedTarget = useStoreValue(controller.training.state, state => state.target);
  const trainingSet = useStoreValue(controller.settings, settings => family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
  const target = selectedTarget?.family === family
    ? selectedTarget
    : null;
  const [thumbnailModels, setThumbnailModels] = useState<Map<string, LastLayerThumbnailModel>>(new Map());
  const catalogue = useMemo(() => lastLayerCaseCatalogue(family, trainingSet), [family, trainingSet]);
  const attempts = useStore(controller.trainingAttempts);
  const statsByCase = useMemo(() => trainingStatsByCase(attempts), [attempts]);

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
        <div className="row wrap"><span className="chip small">{catalogue.length} cases</span>
          <button className="ghost small" onClick={() => controller.randomTrainingCase(family)}>Random case</button>
          <button className="ghost small" onClick={() => void controller.reviewTrainingCase(family)}>Review next</button></div>
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
                  const stats = statsByCase.get(trainingCaseKey({ family, origin: "catalog", trainingSet, caseId })!);
                  const performance = trainingPerformanceLabel(stats);
                  return (
                    <button type="button" className={`last-layer-case-button${selected ? " selected" : ""}`} key={item.id} aria-pressed={selected} aria-label={`${item.id}${performance ? `, ${performance}` : ""}`} onClick={() => void controller.selectLastLayerCase(family, caseId)}>
                      {thumbnailModels.get(item.id) ? <LastLayerCaseThumbnail model={thumbnailModels.get(item.id)!} /> : null}
                      <span>{family === "oll" && trainingSet === "full" ? `#${caseId}` : item.name}</span>
                      <TrainingCaseMarker stats={stats} />
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
  const controller = useController();
  const selectedTarget = useStoreValue(controller.training.state, state => state.target);
  const target = selectedTarget?.family === family ? selectedTarget : null;
  if (!target) return null;
  return <>
    <div className="f2l-target-title"><strong>{lastLayerCaseName(target.family, target.caseId, target.trainingSet)}</strong><span className="phase-case">{target.group}</span></div>
    <div className="small dim f2l-origin">{target.origin.kind === "catalog" ? "Catalogue case" : `From solve · ${target.origin.stepName}`}</div>
  </>;
}
