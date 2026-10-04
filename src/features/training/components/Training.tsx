import { TrainingGuided } from "./TrainingGuided";
import { TrainingInsights } from "./TrainingInsights";
import { recognitionStatsByCase } from "../trainingRecognitionPerformance";
import { trainingCatalogueKey } from "../../../app/trainingCatalogue";
import { TrainingMyAlgorithmMarker } from "./TrainingAlgorithmEditor";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { getLastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { buildLastLayerCatalogueTarget, lastLayerCaseCatalogue, lastLayerCaseName, type LastLayerFamily } from "../../../cube/lastLayerTraining";
import { get3x3x3 } from "../../../cube/puzzle";
import { useController, useStore, useStoreValue } from "../../../app/useController";
import { F2LTraining } from "./F2LTraining";
import { LastLayerCaseThumbnail } from "./LastLayerCaseThumbnail";
import { TrainingWorkspace } from "./TrainingWorkspace";
import { trainingCaseKey, trainingStatsByCase } from "../trainingPerformance";
import { DrillPoolActions } from "./TrainingDrill";
import { TrainingCaseMarker, trainingPerformanceLabel } from "./TrainingPerformance";

export function Training() {
  const controller = useController();
  const family = useStoreValue(controller.training.state, state => state.family);
  const activity = useStoreValue(controller.training.state, state => state.activity);
  const drillStatus = useStoreValue(controller.training.state, state => state.drill.status);
  const [view, setView] = useState<"practice" | "guided" | "insights">("practice");
  const live = useStoreValue(controller.training.state, state => view !== "practice" && (state.phase === "solving" || state.drill.running));
  // Latch presentation ownership when live Training begins; retain Practice afterward.
  if (live && view !== "practice") setView("practice");
  const visibleView = live ? "practice" : view;
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activity !== "drill" || drillStatus === "configuring") return;
    // Collapsing a long catalogue must not leave the run controls/summary above
    // the old scroll position. This changes presentation only and never focus.
    if (screen.current) {
      screen.current.scrollTop = 0;
      const body = screen.current.querySelector<HTMLElement>(".app-body");
      if (body) body.scrollTop = 0;
    }
  }, [activity, drillStatus]);
  return (
    <div className="training-screen" ref={screen}>
      <TrainingViewNavigation view={visibleView} onSelect={setView} />
      {visibleView === "insights" ? <TrainingInsights /> : visibleView === "guided" ? <TrainingGuided onLoaded={() => setView("practice")} /> : <>
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
      <nav className="training-activity-switch area-switch" aria-label="Training activity">
        {(["single", "drill"] as const).map(option => <button type="button" key={option}
          aria-pressed={activity === option} className={activity === option ? "active" : ""}
          onClick={() => controller.setTrainingActivity(option)}>{option === "single" ? "Single" : "Drill"}</button>)}
      </nav>
      {family === "f2l" ? <F2LTraining /> : <LastLayerTraining family={family} />}
      </>}
    </div>
  );
}

/** A solve-phase change only rerenders this switch, never the Practice catalogue. */
function TrainingViewNavigation({ view, onSelect }: { view: "practice" | "guided" | "insights"; onSelect: (view: "practice" | "guided" | "insights") => void }) {
  const controller = useController();
  const live = useStoreValue(controller.training.state, state => state.phase === "solving" || state.drill.running);
  return <nav className="area-switch" aria-label="Training views">
    <button aria-pressed={view === "practice"} onClick={() => onSelect("practice")}>Practice</button>
    <button aria-pressed={view === "guided"} disabled={live} onClick={() => { if (!live) onSelect("guided"); }}>Guided</button>
    <button aria-pressed={view === "insights"} disabled={live} onClick={() => { if (!live) onSelect("insights"); }}>Insights</button>
  </nav>;
}

function LastLayerTraining({ family }: { family: LastLayerFamily }) {
  return <TrainingWorkspace library={<LastLayerCaseLibrary family={family} />}
    details={<LastLayerTargetDetails family={family} />} emptyMessage={<>Select a {family.toUpperCase()} case.</>} />;
}

function LastLayerCaseLibrary({ family }: { family: LastLayerFamily }) {
  const controller = useController();
  const selectedTarget = useStoreValue(controller.training.state, state => state.target);
  const activity = useStoreValue(controller.training.state, state => state.activity);
  const drill = useStoreValue(controller.training.state, state => state.drill);
  const selectedSet = useStoreValue(controller.settings, settings => family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
  const trainingSet = drill.status === "summary" && drill.context?.family === family ? drill.context.trainingSet : selectedSet;
  const target = selectedTarget?.family === family
    ? selectedTarget
    : null;
  const [thumbnailModels, setThumbnailModels] = useState<Map<string, LastLayerThumbnailModel>>(new Map());
  const catalogue = useMemo(() => lastLayerCaseCatalogue(family, trainingSet), [family, trainingSet]);
  const preferences = useStore(controller.trainingAlgorithmPreferences);
  const preferredKeys = useMemo(() => new Set(preferences.map(p => p.key)), [preferences]);
  const attempts = useStore(controller.trainingAttempts);
  const recognitionAttempts = useStore(controller.trainingRecognitionAttempts);
  const statsByCase = useMemo(() => activity === "drill" && drill.task === "recognition"
    ? recognitionStatsByCase(recognitionAttempts) : trainingStatsByCase(attempts), [activity, drill.task, recognitionAttempts, attempts]);

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
          {activity === "single" ? <><button className="ghost small" onClick={() => controller.randomTrainingCase(family)}>Random case</button>
          <button className="ghost small" onClick={() => void controller.reviewTrainingCase(family)}>Review next</button></> :
            <DrillPoolActions caseIds={catalogue.map(c => c.caseId)} />}</div>
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
                  const selected = activity === "drill" ? drill.selectedCaseIds.includes(caseId) : target?.trainingSet === trainingSet && target.caseId === caseId;
                  const stats = statsByCase.get(trainingCaseKey({ family, origin: "catalog", trainingSet, caseId })!);
                  const performance = trainingPerformanceLabel(stats);
                  return (
                    <button type="button" className={`last-layer-case-button${selected ? " selected" : ""}`} key={item.id} disabled={drill.status !== "configuring"} aria-pressed={selected} aria-label={`${item.id}${performance ? `, ${performance}` : ""}`} onClick={() => activity === "drill" ? controller.toggleDrillCase(caseId) : void controller.selectLastLayerCase(family, caseId)}>
                      {thumbnailModels.get(item.id) ? <LastLayerCaseThumbnail model={thumbnailModels.get(item.id)!} /> : null}
                      <span>{family === "oll" && trainingSet === "full" ? `#${caseId}` : item.name}</span>
                      {activity === "drill" && selected ? <span className="drill-pool-marker">✓ Selected</span> : null}
                      {preferredKeys.has(trainingCatalogueKey({ family, trainingSet, caseId })) ? <TrainingMyAlgorithmMarker /> : null}
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
