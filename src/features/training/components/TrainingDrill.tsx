import { useController, useStore, useTrainingState } from "../../../app/useController";
import { formatTime } from "../../../shared/time";
import { drillCatalogue, drillCaseId, trainingDrillSummary, weakDrillCases, type TrainingDrillStrategy } from "../trainingDrill";

export const DRILL_STRATEGIES: { id: TrainingDrillStrategy; label: string; description: string }[] = [
  { id: "sequence", label: "Sequence", description: "Cycle selected cases in catalogue order." },
  { id: "random", label: "Random", description: "Choose selected cases uniformly." },
  { id: "weighted", label: "Weighted worst", description: "Show weaker selected cases more often using your Training history." },
];

export function DrillPoolActions({ caseIds }: { caseIds: readonly string[] }) {
  const controller = useController();
  const { drill } = useTrainingState();
  return <div className="row wrap drill-pool-actions" role="group" aria-label="Drill case selection">
    <button className="ghost small" disabled={drill.status !== "configuring"} onClick={() => controller.setDrillCases(caseIds)}>Select all</button>
    <button className="ghost small" disabled={drill.status !== "configuring"} onClick={() => controller.setDrillCases([])}>Clear</button>
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
  const { drill } = useTrainingState();
  const strategy = DRILL_STRATEGIES.find(s => s.id === drill.strategy)!;
  const summary = trainingDrillSummary(drill.outcomes);
  return <section className="panel training-drill-panel" aria-label="Training drill">
    <div className="panel-head"><span className="panel-title">Drill</span>
      {drill.running ? <span className="chip">Round {drill.round}</span> : null}
    </div>
    <div className="panel-body">
      <p className="small dim">Drills use Virtual case mode. The smart cube supplies turns; its real piece state is ignored.</p>
      {drill.running ? <>
        <div className="row wrap small"><strong>{strategy.label}</strong><span>{drill.selectedCaseIds.length} selected</span></div>
        <DrillRunMetrics summary={summary} />
        <div className="row wrap drill-actions">
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


function DrillRunMetrics({ summary }: { summary: ReturnType<typeof trainingDrillSummary> }) {
  return <dl className="drill-run-metrics">
    <div><dt>Solved</dt><dd>{summary.solved}</dd></div><div><dt>Skipped</dt><dd>{summary.skipped}</dd></div>
    {summary.averageCaseTimeMs !== null ? <div><dt>Avg case time</dt><dd>{formatTime(summary.averageCaseTimeMs)}</dd></div> : null}
    {summary.bestCaseTimeMs !== null ? <div><dt>Best case time</dt><dd>{formatTime(summary.bestCaseTimeMs)}</dd></div> : null}
    {summary.averageStm !== null ? <div><dt>Avg STM</dt><dd>{summary.averageStm.toFixed(1)}</dd></div> : null}
  </dl>;
}

export function TrainingDrillControls() {
  const controller = useController();
  const { phase } = useTrainingState();
  return <div className="row wrap drill-actions drill-stage-controls">
    {phase === "ready" ? <button onClick={() => controller.skipTrainingDrillCase()}>Skip case</button> : null}
    {phase === "result" ? <DrillCountdown /> : null}
  </div>;
}

export function TrainingDrillSummary() {
  const controller = useController();
  const { drill } = useTrainingState();
  const attempts = useStore(controller.trainingAttempts);
  const cases = drill.context ? drillCatalogue(drill.context).filter(c => drill.selectedCaseIds.includes(drillCaseId(c))) : [];
  const summary = trainingDrillSummary(drill.outcomes);
  const weak = weakDrillCases(cases, drill.outcomes, attempts);
  return <section className="panel drill-summary" aria-label="Drill summary">
    <div className="panel-head"><span className="panel-title">Drill complete</span></div>
    <div className="panel-body">
      <p>{summary.rounds} rounds · {summary.solved} solved · {summary.skipped} skipped</p>
      <DrillRunMetrics summary={summary} />
      {weak.length ? <><h3>Needs work</h3><ul className="drill-weak-cases">{weak.map(c => <li key={c.caseId}>
        <strong>{c.target.family === "f2l" ? c.caseId : `${c.target.family.toUpperCase()} ${c.caseId}`}</strong>
        <span>{c.skipped > 0 ? `${c.skipped} ${c.skipped === 1 ? "skip" : "skips"}` :
          c.timingRatio !== null && c.timingRatio > 1.2 && c.averageCaseTimeMs !== null ? `${formatTime(c.averageCaseTimeMs)} average case time` :
          c.recentMedianDelta !== null && c.recentMedianDelta > 0 ? `+${c.recentMedianDelta} STM` : "Needs historical review"}</span>
      </li>)}</ul></> : <p className="small dim">No weak cases identified this drill.</p>}
      <div className="row wrap drill-actions">
        <button disabled={!weak.length} onClick={() => controller.finishTrainingDrillSummary(true)}>Drill weak cases</button>
        <button onClick={() => controller.finishTrainingDrillSummary()}>Repeat same set</button>
        <button className="ghost" onClick={() => controller.finishTrainingDrillSummary()}>Done</button>
      </div>
    </div>
  </section>;
}
