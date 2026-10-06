import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { useMemo, useState } from "react";
import type { TrainingDrillPresetContext } from "../../../app/types";
import { useController, useStore, useStoreValue } from "../../../app/useController";
import { TRAINING_STAGES, trainingCurriculum } from "../trainingCurriculum";
import { trainingPlan, type TrainingGuidedMode } from "../trainingPlanner";
import { TrainingContextSelector } from "./TrainingContextSelector";
import { catalogueContextLabel } from "./TrainingInsights";
import { DRILL_STRATEGIES } from "./TrainingDrill";

const modes: { id: TrainingGuidedMode; label: string; description: string }[] = [
  { id: "learn", label: "Learn", description: "Introduce a few cases at a time and build recognition before execution." },
  { id: "review", label: "Review", description: "Mix weak, due, slow and retention cases." },
  { id: "speed", label: "Speed", description: "Push already reliable cases faster and more efficiently." },
  { id: "weaknesses", label: "Weaknesses", description: "Focus directly on current recognition and execution problems." },
  { id: "competition", label: "Competition prep", description: "Refresh established cases and broad coverage." },
];
const stageLabel = (stage: string) => stage[0].toUpperCase() + stage.slice(1);

export function TrainingGuided({ onLoaded }: { onLoaded: () => void }) {
  const { date } = useDateTimeFormat();
  const controller = useController(), execution = useStore(controller.trainingAttempts), recognition = useStore(controller.trainingRecognitionAttempts);
  const applying = useStore(controller.trainingDrillConfigurationApplying);
  const canConfigure = useStoreValue(controller.training.state, s => s.drill.status === "configuring" && s.phase !== "solving");
  const [context, setContext] = useState<TrainingDrillPresetContext>({ family: "pll", trainingSet: "full" });
  const [mode, setMode] = useState<TrainingGuidedMode>("learn");
  // Recompute due state when this presentation renders, with an explicit clock input.
  const now = Date.now();
  const curriculum = useMemo(() => trainingCurriculum(context, execution, recognition, now), [context, execution, recognition, now]);
  const plan = useMemo(() => trainingPlan(curriculum, mode), [curriculum, mode]);
  return <div className="training-insights">
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Guided training</h2></div><div className="panel-body">
      <TrainingContextSelector context={context} onChange={value => { if (value) setContext(value); }} />
      <h3>{mode === "learn" ? "Learn " : ""}{catalogueContextLabel(curriculum.cases[0].target)}</h3><p>{curriculum.cases.length} cases</p>
      <dl className="training-insight-metrics" aria-label="Curriculum stages">{TRAINING_STAGES.map(stage => <div key={stage}><dt>{stageLabel(stage)}</dt><dd>{curriculum.stageCounts[stage]}</dd></div>)}</dl>
      <p>Due for review: {curriculum.dueCount} · Active learning cohort: {curriculum.activeCohort.length}</p>
      <details><summary>How stages and review work</summary><p className="small dim">New has no history. Learning needs three recognition answers. Recall builds dependable recognition and at least three execution attempts. Reliable has established practice in both. Fast needs five attempts in each, perfect latest-five recognition accuracy, available recent timing at most 15% above personal best, and available recent effective STM delta at most zero. Missing timing alone does not block Fast. Maintenance adds ten attempts in each over at least seven elapsed days. Recent weaknesses can move stages backward.</p>
        <p className="small dim">Reliable is due after one day, Fast after three, Maintenance after seven. Earlier stages need practice now. These are guidance derived from history.</p></details>
      <div className="drill-strategies" role="group" aria-label="Guided mode">{modes.map(option => <button key={option.id} aria-pressed={mode === option.id} onClick={() => setMode(option.id)}>
        <strong>{option.label}</strong><span className="small dim">{option.description}</span></button>)}</div>
    </div></section>
    {plan.explanation ? <p>{plan.explanation}</p> : null}
    {plan.attention.length ? <p>Build recall before competition: {plan.attention.join(", ")}</p> : null}
    {plan.blocks.map(block => <section className="panel" key={block.id}><div className="panel-head"><h3 className="panel-title">{block.label}</h3></div><div className="panel-body">
      <p><strong>{block.task === "recognition" ? "Recognition" : "Execution"} · {block.caseIds.length} cases</strong> · {DRILL_STRATEGIES.find(s => s.id === block.strategy)!.label}</p>
      <p>{block.reason}</p>
      {block.composition ? <p className="small dim">{Object.entries(block.composition).filter(([, count]) => count).map(([category, count]) => `${count} ${category === "support" ? "recognition support" : category}`).join(" · ")}</p> : null}
      <p>{block.caseIds.map(id => curriculum.cases.find(c => c.caseId === id)!.label).join(", ")}</p>
      <button disabled={applying || !canConfigure} onClick={async () => { if (await controller.applyGuidedTrainingBlock(block)) onLoaded(); }}>Load block</button>
      <p className="small dim">Load into Practice, then press Start drill when ready.</p>
    </div></section>)}
    <section className="panel"><div className="panel-head"><h3 className="panel-title">Curriculum cases</h3></div><div className="panel-body table-scroll">
      <table className="stats-table"><thead><tr><th>Case</th><th>Stage</th><th>Review</th></tr></thead><tbody>{curriculum.cases.map(c => <tr key={c.key}>
        <td>{c.label}</td><td>{stageLabel(c.stage)}</td><td>{c.due ? "Due now" : date(c.dueAt)}</td></tr>)}</tbody></table>
    </div></section>
  </div>;
}
