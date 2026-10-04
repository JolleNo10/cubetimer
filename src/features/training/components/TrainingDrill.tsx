import { useController, useStore, useTrainingState } from "../../../app/useController";
import type { TrainingDrillStrategy } from "../trainingDrill";

export const DRILL_STRATEGIES: { id: TrainingDrillStrategy; label: string; description: string }[] = [
  { id: "sequence", label: "Sequence", description: "Cycle selected cases in catalogue order." },
  { id: "random", label: "Random", description: "Choose selected cases uniformly." },
  { id: "weighted", label: "Weighted worst", description: "Show weaker selected cases more often using your Training history." },
];

export function DrillPoolActions({ caseIds }: { caseIds: readonly string[] }) {
  const controller = useController();
  const { drill } = useTrainingState();
  return <div className="row wrap drill-pool-actions" role="group" aria-label="Drill case selection">
    <button className="ghost small" disabled={drill.running} onClick={() => controller.setDrillCases(caseIds)}>Select all</button>
    <button className="ghost small" disabled={drill.running} onClick={() => controller.setDrillCases([])}>Clear</button>
    <span className="chip small">{drill.selectedCaseIds.length} selected</span>
  </div>;
}

/** Only this small presentation subscribes to the RAF-frequency countdown Store. */
export function DrillCountdown({ initial = false }: { initial?: boolean }) {
  const controller = useController();
  const remaining = useStore(controller.training.drillCountdown);
  if (remaining === null) return null;
  const seconds = Math.ceil(remaining / 1000);
  return <div className={`drill-countdown${initial ? " initial" : ""}`} role="status" aria-live="polite">
    {initial ? <><span className="small dim">Case starting</span><strong>{seconds}</strong></> : <>Next case in {seconds}</>}
  </div>;
}

export function TrainingDrillPanel() {
  const controller = useController();
  const { drill, phase, target } = useTrainingState();
  const strategy = DRILL_STRATEGIES.find(s => s.id === drill.strategy)!;
  return <section className="panel training-drill-panel" aria-label="Training drill">
    <div className="panel-head"><span className="panel-title">Drill</span>
      {drill.running ? <span className="chip">Round {drill.round}</span> : null}
    </div>
    <div className="panel-body">
      <p className="small dim">Drills use Virtual case mode. The smart cube supplies turns; its real piece state is ignored.</p>
      {drill.running ? <>
        <div className="row wrap small"><strong>{strategy.label}</strong><span>{drill.selectedCaseIds.length} selected</span></div>
        {target && phase === "result" ? <DrillCountdown /> : null}
        <div className="row wrap drill-actions">
          {phase === "ready" ? <button onClick={() => controller.skipTrainingDrillCase()}>Skip case</button> : null}
          <button className="ghost" onClick={() => controller.stopTrainingDrill()}>Stop drill</button>
        </div>
      </> : <>
        <div className="drill-strategies" role="group" aria-label="Drill strategy">
          {DRILL_STRATEGIES.map(s => <button type="button" key={s.id} aria-pressed={s.id === drill.strategy}
            className={s.id === drill.strategy ? "selected" : ""} onClick={() => controller.setDrillStrategy(s.id)}>
            <strong>{s.label}</strong><span className="small dim">{s.description}</span>
          </button>)}
        </div>
        <div className="row wrap drill-actions"><span className="small">{drill.selectedCaseIds.length} selected</span>
          <button className="primary" disabled={!drill.selectedCaseIds.length} onClick={() => controller.startTrainingDrill()}>Start drill</button>
        </div>
      </>}
    </div>
  </section>;
}
