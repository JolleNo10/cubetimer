import { useState } from "react";
import type { TrainingDrillPreset, TrainingRecognitionAttempt } from "../../../app/types";
import { f2lPositionLabel } from "../../../cube/f2lCases";
import { f2lTrainingCatalogue } from "../../../cube/f2lTrainingCases";
import { useController, useStore, useTrainingState } from "../../../app/useController";
import { formatTime } from "../../../shared/time";
import { drillCatalogue, drillCaseId, trainingDrillSummary, weakDrillCases, recognitionDrillSummary, weakRecognitionDrillCases, drillCaseMetadata, type TrainingDrillStrategy } from "../trainingDrill";

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
  const applying = useStore(controller.trainingDrillPresetApplying);
  const strategy = DRILL_STRATEGIES.find(s => s.id === drill.strategy)!;
  return <section className="panel training-drill-panel" aria-label="Training drill">
    <div className="panel-head"><span className="panel-title">Drill</span>
      {drill.running ? <span className="chip">{drill.round === 0 ? "Starting" : `Round ${drill.round}`}</span> : null}
    </div>
    <div className="panel-body">
      <p className="small dim">Drills use Virtual case mode. {drill.task === "recognition" ? "Identify the case using the choices; cube turns are ignored." : "The smart cube supplies turns; its real piece state is ignored."}</p>
      {drill.running ? <>
        <div className="row wrap small"><strong>{drill.task === "recognition" ? "Recognition" : "Execution"} · {strategy.label}</strong><span>{drill.selectedCaseIds.length} selected</span></div>
        <DrillTaskMetrics />
        <div className="row wrap drill-actions">
          <button className="ghost" onClick={() => controller.stopTrainingDrill()}>Stop drill</button>
        </div>
      </> : drill.status === "configuring" ? <>
        <div className="drill-strategies" role="group" aria-label="Drill task">
          {(["execution", "recognition"] as const).map(task => <button type="button" key={task} aria-label={`${task === "execution" ? "Execution" : "Recognition"} task`} aria-pressed={drill.task === task}
            className={drill.task === task ? "selected" : ""} onClick={() => controller.setDrillTask(task)}>
            <strong>{task === "execution" ? "Execution" : "Recognition"}</strong><span className="small dim">
              {task === "execution" ? "Recognize the case and solve it." : "Identify the case without executing it."}</span>
          </button>)}
        </div>
        <SavedDrills />
        <div className="drill-strategies" role="group" aria-label="Drill strategy">
          {DRILL_STRATEGIES.map(s => <button type="button" key={s.id} aria-pressed={s.id === drill.strategy}
            className={s.id === drill.strategy ? "selected" : ""} onClick={() => controller.setDrillStrategy(s.id)}>
            <strong>{s.label}</strong><span className="small dim">{s.description}</span>
          </button>)}
        </div>
        {drill.task === "recognition" && drill.selectedCaseIds.length < 2 ? <p className="small dim">Select at least two cases for meaningful recognition choices.</p> : null}
        <div className="row wrap drill-actions"><span className="small">{drill.selectedCaseIds.length} selected</span>
          <button className="primary" disabled={applying || drill.selectedCaseIds.length < (drill.task === "recognition" ? 2 : 1)} onClick={() => controller.startTrainingDrill()}>Start drill</button>
        </div>
      </> : null}
    </div>
  </section>;
}


export function drillPresetDescription(preset: TrainingDrillPreset): string {
  const context = preset.context;
  const catalogue = context.family === "f2l"
    ? `${f2lTrainingCatalogue(context.library).label} F2L · ${f2lPositionLabel(context.position)}`
    : `${context.trainingSet === "full" ? "Full" : "2-Look"} ${context.family.toUpperCase()}`;
  return `${catalogue} · ${preset.caseIds.length} ${preset.caseIds.length === 1 ? "case" : "cases"} · ${DRILL_STRATEGIES.find(s => s.id === preset.strategy)!.label} · ${preset.task === "recognition" ? "Recognition" : "Execution"}`;
}

/** Selection and inline editors are presentation state, never a live preset binding. */
export function SavedDrills() {
  const controller = useController();
  const { activity, drill } = useTrainingState();
  const presets = useStore(controller.trainingDrillPresets);
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<"save" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const validPool = drill.selectedCaseIds.length >= (drill.task === "recognition" ? 2 : 1);
  const selected = presets.find(p => p.id === selectedId) ?? presets[0];
  if (activity !== "drill" || drill.status !== "configuring") return null;
  const close = () => { setEditor(null); setName(""); };
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try { if (await action()) close(); } finally { setBusy(false); }
  };
  return <section className="saved-drills" aria-label="Saved drills">
    <h3 className="small faint">Saved drills</h3>
    {presets.length ? <>
      <label className="saved-drill-selector"><span className="sr-only">Saved drill</span>
        <select value={selected?.id ?? ""} disabled={busy} onChange={event => { setSelectedId(event.target.value); close(); }}>
          {presets.map(p => <option key={p.id} value={p.id}>{p.name} · {drillPresetDescription(p)}</option>)}
        </select>
      </label>
      {selected ? <p className="small dim saved-drill-context">{drillPresetDescription(selected)}</p> : null}
      <div className="row wrap saved-drill-actions">
        <button type="button" disabled={busy || !selected} onClick={() => void run(() => controller.applyTrainingDrillPreset(selected!.id))}>Load</button>
        <button type="button" disabled={busy || !selected || !validPool} onClick={() => void run(() => controller.updateTrainingDrillPreset(selected!.id))}>Update</button>
        <button type="button" disabled={busy || !selected} onClick={() => { setName(selected!.name); setEditor("rename"); }}>Rename</button>
        <button type="button" className="danger ghost" disabled={busy || !selected} onClick={() => {
          if (selected && confirm(`Delete saved drill "${selected.name}"?`)) void run(() => controller.deleteTrainingDrillPreset(selected.id));
        }}>Delete</button>
      </div>
    </> : <p className="small dim">No saved drills yet.</p>}
    {editor ? <form className="saved-drill-editor row wrap" onSubmit={event => {
      event.preventDefault();
      if (!name.trim() || busy) return;
      void run(() => editor === "save" ? controller.createTrainingDrillPreset(name) : controller.renameTrainingDrillPreset(selected!.id, name));
    }} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); close(); } }}>
      <label><span className="sr-only">{editor === "save" ? "New drill name" : "Drill name"}</span>
        <input autoFocus maxLength={80} value={name} disabled={busy} placeholder="Drill name" onChange={event => setName(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || !name.trim() || (editor === "save" && !validPool)}>{editor === "save" ? "Save" : "Save name"}</button>
      <button type="button" className="ghost" disabled={busy} onClick={close}>Cancel</button>
    </form> : <button type="button" className="ghost" disabled={busy || !validPool}
      onClick={() => { setName(""); setEditor("save"); }}>Save current as…</button>}
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

function DrillTaskMetrics() {
  const { drill } = useTrainingState();
  return drill.task === "recognition" ? <RecognitionMetrics summary={recognitionDrillSummary(drill.outcomes)} /> :
    <DrillRunMetrics summary={trainingDrillSummary(drill.outcomes)} />;
}

function RecognitionMetrics({ summary }: { summary: ReturnType<typeof recognitionDrillSummary> }) {
  return <dl className="drill-run-metrics">
    <div><dt>Answered</dt><dd>{summary.answered}</dd></div><div><dt>Correct</dt><dd>{summary.correct}</dd></div>
    <div><dt>Incorrect</dt><dd>{summary.incorrect}</dd></div><div><dt>Skipped</dt><dd>{summary.skipped}</dd></div>
    <div><dt>Accuracy</dt><dd>{summary.accuracy === null ? "—" : `${Math.round(summary.accuracy * 100)}%`}</dd></div>
    <div><dt>Median correct recognition</dt><dd>{formatTime(summary.medianCorrectResponseMs)}</dd></div>
    <div><dt>Best correct recognition</dt><dd>{formatTime(summary.bestCorrectResponseMs)}</dd></div>
  </dl>;
}

function DrillSummaryActions({ hasWeakCases }: { hasWeakCases: boolean }) {
  const controller = useController(), { drill } = useTrainingState();
  useStore(controller.settings);
  const compatible = drill.task === "execution" || JSON.stringify(drill.context) === JSON.stringify(controller.training.drillConfigurationContext);
  return <>
    {!compatible ? <p className="small dim">Restore this run's Training catalogue in Settings before repeating its cases.</p> : null}
    <div className="row wrap drill-actions">
      <button disabled={!hasWeakCases || !compatible} onClick={() => controller.finishTrainingDrillSummary(true)}>Drill weak cases</button>
      <button disabled={!compatible} onClick={() => controller.finishTrainingDrillSummary()}>Repeat same set</button>
    </div>
  </>;
}

function RecognitionDrillSummary({ attempts }: { attempts: readonly TrainingRecognitionAttempt[] }) {
  const { drill } = useTrainingState();
  const cases = drill.context ? drillCatalogue(drill.context).filter(c => drill.selectedCaseIds.includes(drillCaseId(c))) : [];
  const summary = recognitionDrillSummary(drill.outcomes), weak = weakRecognitionDrillCases(cases, drill.outcomes, attempts);
  return <section className="panel drill-summary" aria-label="Drill summary">
    <div className="panel-head"><span className="panel-title">Recognition drill complete</span></div>
    <div className="panel-body"><p>{summary.rounds} {summary.rounds === 1 ? "round" : "rounds"}</p>
      <RecognitionMetrics summary={summary} />
      {weak.length ? <><h3>Needs work</h3><ul className="drill-weak-cases">{weak.map(c => <li key={c.caseId}>
        <strong>{drillCaseMetadata(c.target).label}</strong><span>{c.incorrect ? `${c.incorrect} incorrect` :
          c.skipped ? `${c.skipped} skipped` : c.timingRatio !== null && c.timingRatio > 1.2 ? "Slower correct recognition" : "Needs historical review"}</span>
      </li>)}</ul></> : <p className="small dim">No weak cases identified this drill.</p>}
      <DrillSummaryActions hasWeakCases={weak.length > 0} />
    </div>
  </section>;
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
  const recognitionAttempts = useStore(controller.trainingRecognitionAttempts);
  const cases = drill.context ? drillCatalogue(drill.context).filter(c => drill.selectedCaseIds.includes(drillCaseId(c))) : [];
  if (drill.task === "recognition") return <RecognitionDrillSummary attempts={recognitionAttempts} />;
  const summary = trainingDrillSummary(drill.outcomes);
  const weak = weakDrillCases(cases, drill.outcomes, attempts);
  return <section className="panel drill-summary" aria-label="Drill summary">
    <div className="panel-head"><span className="panel-title">Drill complete</span></div>
    <div className="panel-body">
      <p>{summary.rounds} {summary.rounds === 1 ? "round" : "rounds"} · {summary.solved} solved · {summary.skipped} skipped</p>
      <DrillRunMetrics summary={summary} />
      {weak.length ? <><h3>Needs work</h3><ul className="drill-weak-cases">{weak.map(c => <li key={c.caseId}>
        <strong>{c.target.family === "f2l" ? c.caseId : `${c.target.family.toUpperCase()} ${c.caseId}`}</strong>
        <span>{c.skipped > 0 ? `${c.skipped} ${c.skipped === 1 ? "skip" : "skips"}` :
          c.timingRatio !== null && c.timingRatio > 1.2 && c.averageCaseTimeMs !== null ? `${formatTime(c.averageCaseTimeMs)} average case time` :
          c.recentMedianDelta !== null && c.recentMedianDelta > 0 ? `+${c.recentMedianDelta} STM` : "Needs historical review"}</span>
      </li>)}</ul></> : <p className="small dim">No weak cases identified this drill.</p>}
      <DrillSummaryActions hasWeakCases={weak.length > 0} />
    </div>
  </section>;
}
