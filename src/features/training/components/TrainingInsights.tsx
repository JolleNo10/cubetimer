import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { useMemo, useState } from "react";
import { trainingContextHistory } from "../trainingBrowseContext";
import { TrainingContextSelector } from "./TrainingContextSelector";
import type { TrainingCatalogueIdentity, TrainingDrillPresetContext } from "../../../app/types";
import { useController, useStore } from "../../../app/useController";
import { f2lPositionLabel } from "../../../cube/f2lCases";
import { formatTime } from "../../../shared/time";
import { drillCaseMetadata } from "../trainingDrill";
import { trainingAnalytics, trainingInsightsCatalogue, trainingTrends } from "../trainingAnalytics";

const catalogue = trainingInsightsCatalogue();

const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const delta = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${Number(value.toFixed(2))} STM`;
const timeDelta = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatTime(Math.abs(value))}`;
const status = { new: "New", learning: "Learning", review: "Needs review", practiced: "Practised" };
export function catalogueContextLabel(target: TrainingCatalogueIdentity): string {
  return target.family === "f2l" ? `${target.library === "basic" ? "Basic" : "Advanced"} F2L · ${f2lPositionLabel(target.position)}` :
    `${target.trainingSet === "full" ? "Full" : "2-Look"} ${target.family.toUpperCase()}`;
}
function caseLabel(target: TrainingCatalogueIdentity, id?: string) {
  const other = target.family === "f2l" ? { ...target, caseName: id ?? target.caseName } : { ...target, caseId: id ?? target.caseId };
  return drillCaseMetadata(other).label;
}
function Metrics({ values }: { values: [string, string | number][] }) {
  return <dl className="training-insight-metrics">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** Presentation reads the two histories once; no runtime or Timer context is modified. */
export function TrainingInsights() {
  const { date, dateOnly } = useDateTimeFormat();
  const controller = useController(), execution = useStore(controller.trainingAttempts), recognition = useStore(controller.trainingRecognitionAttempts);
  const [window, setWindow] = useState<25 | 50 | 100 | "all">(50);
  const [context, setContext] = useState<TrainingDrillPresetContext | null>(null);
  const scoped = useMemo(() => trainingContextHistory(execution, recognition, context), [execution, recognition, context]);
  const analytics = useMemo(() => trainingAnalytics(scoped.execution, scoped.recognition, scoped.catalogue ?? catalogue), [scoped]);
  const trends = useMemo(() => trainingTrends(scoped.execution, scoped.recognition, window), [scoped, window]);
  const e = analytics.execution, r = analytics.recognition, progression = analytics.progression;
  return <div className="training-insights">
    <section className="panel"><div className="panel-body"><TrainingContextSelector context={context} onChange={setContext} all />
      <p>{context ? `Selected context: ${catalogueContextLabel(scoped.catalogue![0])}` : "Overall: all Training contexts"}</p></div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Execution</h2></div><div className="panel-body">
      <Metrics values={[["Attempts", e.attempts], ["Median move span", formatTime(e.medianMoveSpanMs)], ["Best move span", formatTime(e.bestMoveSpanMs)],
        ["Median Drill case time", formatTime(e.medianCaseTimeMs)], ["Best Drill case time", formatTime(e.bestCaseTimeMs)],
        ["Recent effective STM delta", delta(e.recentMedianDelta)], ["Canonical reference match rate", percent(e.canonicalMatchRate)],
        ["Personal benchmark attempts", e.personal.attempts], ["Matched My Algorithm", e.personal.matched],
        ["My Algorithm match rate", percent(e.personal.matchRate)], ["Median personal STM delta", delta(e.personal.medianDelta)]]} />
      <p className="small dim">Move span is first to last registered move. Drill case time includes recognition. STM uses My Algorithm when that attempt had it, otherwise recommended.</p>
    </div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Recognition</h2></div><div className="panel-body">
      <Metrics values={[["Attempts", r.attempts], ["Correct", r.correct], ["Incorrect", r.incorrect], ["Accuracy", percent(r.accuracy)],
        ["Recent accuracy", percent(r.recentAccuracy)], ["Median correct response", formatTime(r.medianCorrectResponseMs)],
        ["Best correct response", formatTime(r.bestCorrectResponseMs)]]} />
      <p className="small dim">Recent accuracy uses the latest five answers. Speed includes correct answers only.</p>
    </div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Cases</h2></div><div className="panel-body table-scroll">
      {analytics.cases.length ? <table className="stats-table training-insight-table"><thead><tr><th>Case / context</th><th>Group</th><th>Execution attempts / status</th>
        <th>Recent execution time</th><th>Effective STM delta</th><th>My Algorithm match</th><th>Recognition attempts</th><th>Accuracy</th><th>Correct recognition median</th><th>Last practised</th></tr></thead>
        <tbody>{analytics.cases.map(c => <tr key={c.key}><td>{c.label}<small>{catalogueContextLabel(c.target)}</small></td><td>{c.group}</td>
          <td>{c.execution.attempts} · {status[c.execution.status]}</td><td>{formatTime(c.execution.recentMedianCaseTimeMs ?? c.execution.recentMedianMoveSpanMs)}</td>
          <td>{delta(c.execution.recentMedianDelta)}</td><td>{percent(c.personal.matchRate)}</td><td>{c.recognition.attempts}</td>
          <td>{percent(c.recognition.accuracy)}</td><td>{formatTime(c.recognition.medianCorrectResponseMs)}</td>
          <td>{c.lastPracticedAt === null ? "—" : dateOnly(c.lastPracticedAt)}</td></tr>)}</tbody></table> : <p>No catalogue Training history yet.</p>}
      <p className="small dim">Recent execution time uses Drill case time when available, otherwise move span.</p>
    </div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Common recognition confusions</h2></div><div className="panel-body">
      {analytics.confusions.length ? <ul>{analytics.confusions.slice(0, 10).map(c => <li key={`${JSON.stringify(c.target)}:${c.answerCaseId}`}>
        {caseLabel(c.target)} → {caseLabel(c.target, c.answerCaseId)} · {c.count} {c.count === 1 ? "answer" : "answers"}
        <span className="small dim"> · {catalogueContextLabel(c.target)}</span></li>)}</ul> : <p>No incorrect Recognition answers recorded.</p>}
    </div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Groups</h2></div><div className="panel-body table-scroll">
      <table className="stats-table"><thead><tr><th>Group / context</th><th>Recognition accuracy</th><th>Correct response median</th><th>Execution Drill case median</th><th>Effective STM delta</th></tr></thead>
        <tbody>{analytics.groups.map(g => <tr key={g.key}><td>{g.group}<small>{catalogueContextLabel(g.target)}</small></td><td>{percent(g.recognition.accuracy)}</td>
          <td>{formatTime(g.recognition.medianCorrectResponseMs)}</td><td>{formatTime(g.execution.medianCaseTimeMs)}</td><td>{delta(g.execution.recentMedianDelta)}</td></tr>)}</tbody></table>
    </div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Later-round change</h2></div><div className="panel-body">
      <Metrics values={[["Qualifying Execution runs", progression.executionRuns.length], ["Median later-round case-time difference", timeDelta(progression.medianExecutionDeltaMs)],
        ["Qualifying Recognition runs", progression.recognitionRuns.length], ["Median later-round accuracy difference", progression.medianRecognitionAccuracyDelta === null ? "—" : `${(progression.medianRecognitionAccuracyDelta * 100).toFixed(1)} percentage points`],
        ["Median later-round correct-response difference", timeDelta(progression.medianRecognitionDeltaMs)]]} />
      <p className="small dim">Runs need at least six completed rounds. Compare chronological halves; Execution timing needs two positive observations per half; response speed needs at least two correct answers in each half.</p>
      <details><summary>Run comparisons</summary><ul>{progression.executionRuns.map(run => <li key={run.id}>Execution · {run.rounds} rounds · {formatTime(run.firstMs)} → {formatTime(run.secondMs)} · {timeDelta(run.deltaMs)}</li>)}
        {progression.recognitionRuns.map(run => <li key={run.id}>Recognition · {run.rounds} rounds · {percent(run.firstAccuracy)} → {percent(run.secondAccuracy)} · correct response {formatTime(run.firstMs)} → {formatTime(run.secondMs)}</li>)}</ul></details>
    </div></section>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Chronological trends</h2>
      <label>Window <select value={window} onChange={event => setWindow(event.target.value === "all" ? "all" : Number(event.target.value) as 25 | 50 | 100)}>
        {[25, 50, 100, "all"].map(n => <option key={n} value={n}>{n === "all" ? "All" : n}</option>)}</select></label></div><div className="panel-body">
      <p className="small dim">Each task has its own chronological window. Time, STM and outcomes are separate columns.</p>
      <details><summary>Execution trend · {trends.execution.length} attempts</summary><div className="table-scroll"><table className="stats-table"><thead><tr><th>Date</th><th>Move span</th><th>Drill case time</th><th>Effective STM delta</th><th>Matched My Algorithm</th></tr></thead><tbody>
        {trends.execution.map(a => <tr key={a.id}><td>{date(a.createdAt)}</td><td>{formatTime(a.elapsedMs)}</td><td>{formatTime(a.caseTimeMs)}</td><td>{delta(a.effectiveDelta)}</td><td>{a.matchedPreferred === null ? "—" : a.matchedPreferred ? "Yes" : "No"}</td></tr>)}
      </tbody></table></div></details>
      <details><summary>Recognition trend · {trends.recognition.length} answers</summary><div className="table-scroll"><table className="stats-table"><thead><tr><th>Date</th><th>Outcome</th><th>Correct response time</th></tr></thead><tbody>
        {trends.recognition.map(a => <tr key={a.id}><td>{date(a.createdAt)}</td><td>{a.correct ? "Correct" : "Incorrect"}</td><td>{formatTime(a.correctResponseMs)}</td></tr>)}
      </tbody></table></div></details>
    </div></section>
  </div>;
}
