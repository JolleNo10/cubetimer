import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatSolveTime } from "../state/stats";
import { RECOGNITION_NOTE, sortPerformanceRows, type CaseFocus, type CasePerformance, type CaseSort, type PerformanceSummary, type SortDirection, type StatisticsViewModel } from "../state/statistics";
import type { Solve } from "../../../app/types";
import type { LastLayerFamily } from "../../../cube/lastLayerTraining";
import { get3x3x3 } from "../../../cube/puzzle";
import { buildLastLayerCatalogueTarget } from "../../../cube/lastLayerTraining";
import { getLastLayerThumbnailModel, type LastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { LastLayerCaseThumbnail } from "../../../shared/ui/LastLayerCaseThumbnail";
import { F2lCaseThumbnail } from "../../../shared/ui/F2lCaseThumbnail";
import { getF2lThumbnailModel } from "../../../cube/f2lThumbnail";
import { STEP_NAMES, type SolveStep, type StepName } from "../../../cube/analysis";
import { effectiveCfopAnalysis } from "../../../app/solveAnalysis";
import type { TrainingFamily } from "../../training/TrainingRuntime";
import { statisticsActivationProps } from "./statisticsInteraction";
import { SplitBar, StatCard, StatsSection } from "./StatisticsPrimitives";

const PERFORMANCE_COLUMNS: { id: CaseSort; label: string }[] = [
  { id: "count", label: "Samples" }, { id: "best", label: "Best" }, { id: "median", label: "Median" },
  { id: "recognition", label: "Measured recognition median" }, { id: "execution", label: "Measured execution median" },
  { id: "moves", label: "STM median" }, { id: "tps", label: "Execution TPS" }, { id: "skips", label: "Skips" },
];

export type PerformanceSortState = { column: CaseSort | null; direction: SortDirection; onSort: (column: CaseSort) => void };

/** Same toggle as the Solves table: a new column sorts ascending, the current one reverses. */
function usePerformanceSort(initial: CaseSort | null): PerformanceSortState {
  const [column, setColumn] = useState<CaseSort | null>(initial);
  const [direction, setDirection] = useState<SortDirection>("asc");
  return { column, direction, onSort: (next) => { setDirection(column === next && direction === "asc" ? "desc" : "asc"); setColumn(next); } };
}

export function SortHeader({ id, label, sort }: { id: CaseSort; label: string; sort?: PerformanceSortState }) {
  if (!sort) return <th>{label}</th>;
  const active = sort.column === id;
  return <th aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
    <button className="stats-sort" onClick={() => sort.onSort(id)}>{label}{active ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button>
  </th>;
}

/** A detail row under its summary row, scrolled into view so a selection far down the table is visible. */
function ExpandedRow({ label, columns, children }: { label: string; columns: number; children: ReactNode }) {
  const ref = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [label]);
  return <tr className="stats-expanded" ref={ref}><td colSpan={columns}>{children}</td></tr>;
}

export function PerformanceTable({ rows, labelHeader = "Case / slot / order", sort, onSelect, expandedLabel, expanded, hideSkips = false, renderLabel }: {
  rows: readonly PerformanceSummary[]; labelHeader?: string; sort?: PerformanceSortState; onSelect?: (row: PerformanceSummary) => void;
  /** Detail shown directly under the row with this label. */
  expandedLabel?: string; expanded?: ReactNode;
  hideSkips?: boolean; renderLabel?: (row: PerformanceSummary) => ReactNode;
}) {
  const columns = hideSkips ? PERFORMANCE_COLUMNS.filter(column => column.id !== "skips") : PERFORMANCE_COLUMNS;
  return <div className="table-scroll"><table className="stats-table"><thead><tr>
    <SortHeader id="case" label={labelHeader} sort={sort} />
    {columns.map((column) => <SortHeader key={column.id} id={column.id} label={column.label} sort={sort} />)}
  </tr></thead><tbody>{rows.map((row) => <Fragment key={row.label}><tr className={row.label === expandedLabel ? "selected" : undefined} aria-expanded={onSelect ? row.label === expandedLabel : undefined} {...statisticsActivationProps(onSelect ? () => onSelect(row) : undefined, `View ${row.label} samples`)}><td>{onSelect ? <button className="ghost small stats-open-link" onClick={() => onSelect(row)}>{renderLabel ? renderLabel(row) : row.label}</button> : renderLabel ? renderLabel(row) : row.label}</td><td className="stats-samples">{row.count}{row.count > 0 && row.count < 3 ? <span className="stats-badge small-sample" title="Fewer than 3 observations; medians describe a very small sample.">small sample</span> : null}</td><td className="number">{formatTime(row.bestMs)}</td><td className="number">{formatTime(row.medianMs)}</td><td className="number">{formatTime(row.recognitionMs)}</td><td className="number">{formatTime(row.executionMs)}</td><td className="number">{row.moves ?? "—"}</td><td className="number">{row.tps?.toFixed(2) ?? "—"}</td>{hideSkips ? null : <td className="number">{row.skipCount}</td>}</tr>
    {row.label === expandedLabel && expanded ? <ExpandedRow label={row.label} columns={columns.length + 1}>{expanded}</ExpandedRow> : null}</Fragment>)}</tbody></table></div>;
}

/** Resolve the same Full catalogue preview used by Training, outside statistics state. */
export function StatisticsCaseDiagram({ family, caseId }: { family: LastLayerFamily; caseId: string }) {
  const [preview, setPreview] = useState<{ family: LastLayerFamily; caseId: string; model: LastLayerThumbnailModel } | null>(null);
  useEffect(() => {
    let active = true;
    void get3x3x3().then((kpuzzle) => {
      const built = buildLastLayerCatalogueTarget(kpuzzle, family, caseId);
      const model = getLastLayerThumbnailModel(family, built.pattern, built.info.trainingRotation, built.info.completionGoal);
      if (active) setPreview({ family, caseId, model });
    }).catch(() => {
      if (active) setPreview(null);
    });
    return () => { active = false; };
  }, [family, caseId]);
  return <div className="focus-case-diagram" role="img" aria-label={`${family.toUpperCase()} ${caseId} case diagram`}>
    {preview?.family === family && preview.caseId === caseId ? <LastLayerCaseThumbnail model={preview.model} /> : null}
  </div>;
}

export function StatisticsCaseTable({ family, rows, skipCount, focus = [], model, onOpenSolve, onTrainCase }: {
  family: LastLayerFamily; rows: readonly CasePerformance[]; skipCount: number; focus?: readonly CaseFocus[]; model: StatisticsViewModel;
  onOpenSolve: (solve: Solve) => void; onTrainCase: (family: TrainingFamily, caseId: string) => void;
}) {
  const { date } = useDateTimeFormat();
  const sort = usePerformanceSort("case");
  const [caseId, setCaseId] = useState<string | null>(null);
  const sorted = useMemo(() => sortPerformanceRows(rows, sort.column ?? "case", sort.direction), [rows, sort.column, sort.direction]);
  const selected = rows.find((row) => row.caseId === caseId);
  const members = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  return <StatsSection id={`${family}-cases`} title={`${family.toUpperCase()} cases`} description={`${rows.length} recognised cases · ${skipCount} skips (${model.analysisCount ? (skipCount / model.analysisCount * 100).toFixed(1) : "—"}% of analysed solves)`}>
    {focus.length ? <div className="focus-cases" role="group" aria-label={`Worst ${family.toUpperCase()} cases`}>
      {focus.map(({ reason, row }) => {
        const primary = reason === "total" ? row.medianMs : reason === "recognition" ? row.recognitionMs : row.executionMs;
        const label = reason === "total" ? "Total" : reason === "recognition" ? "Recognition" : "Execution";
        const secondary = reason === "total" ? `Recognition ${formatTime(row.recognitionMs)} · Exec ${formatTime(row.executionMs)}`
          : reason === "recognition" ? `Total ${formatTime(row.medianMs)} · Exec ${formatTime(row.executionMs)}`
            : `Total ${formatTime(row.medianMs)} · Recognition ${formatTime(row.recognitionMs)}`;
        return <div className="focus-case" key={reason}>
          <StatisticsCaseDiagram family={family} caseId={row.caseId} />
          <span className="stat-label">Worst {reason}</span>
          <strong>{family.toUpperCase()} {row.caseId}</strong>
          <strong className="mono">{label} {formatTime(primary)}</strong>
          <span className="small faint">{secondary}</span>
          <span className="small faint">{row.count} samples</span>
          <div className="row"><button className="ghost small" onClick={() => setCaseId(row.caseId)}>View</button>
          <button className="small" onClick={() => onTrainCase(family, row.caseId)}>Train</button></div>
        </div>;
      })}
    </div> : null}
    <p className="small faint">{RECOGNITION_NOTE}</p>
    {rows.length ? <PerformanceTable rows={sorted} labelHeader="Case" sort={sort} onSelect={(row) => setCaseId((current) => current === (row as CasePerformance).caseId ? null : (row as CasePerformance).caseId)} expandedLabel={selected?.label} expanded={selected ? <div className="stats-detail" role="region" aria-label={`${family.toUpperCase()} case solves`}>
      <div className="section-heading"><h3>{family.toUpperCase()} {selected.caseId} · {selected.count} solves</h3><div className="row"><button onClick={() => onTrainCase(family, selected.caseId)}>Train case</button><button className="ghost" onClick={() => setCaseId(null)}>Close case</button></div></div>
      <div className="table-scroll"><table className="stats-table"><thead><tr><th>Solve</th><th>Session</th><th>Date</th></tr></thead><tbody>{selected.solveIds.map((id) => {
        const solve = members.get(id);
        return solve ? <tr key={id} {...statisticsActivationProps(() => onOpenSolve(solve), `View solve ${formatSolveTime(solve)} · ${date(solve.createdAt)}`)}><td><button className="ghost small stats-open-link" onClick={() => onOpenSolve(solve)}>{formatSolveTime(solve)}</button></td><td>{model.eventSessions.find((session) => session.id === solve.sessionId)?.name}</td><td>{date(solve.createdAt)}</td></tr> : null;
      })}</tbody></table></div>
    </div> : undefined} /> : <div className="chart-empty">No recognised non-skipped {family.toUpperCase()} cases in this scope.</div>}
  </StatsSection>;
}

export function StatisticsF2lPerformancePanel({ model, onOpenSolve, mode }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void; mode: "slot" | "order" }) {
  const { date } = useDateTimeFormat();
  const [position, setPosition] = useState<string | null>(null);
  const sort = usePerformanceSort(null);
  const natural = mode === "slot" ? model.f2lSlots : model.f2lPositions;
  const rows = sort.column ? sortPerformanceRows(natural, sort.column, sort.direction) : natural;
  const selected = rows.find((row) => row.label === position);
  const members = new Map(model.scopeSolves.map((solve) => [solve.id, solve]));
  return <section className="f2l-performance-panel" aria-label={mode === "slot" ? "By insertion position" : "By solve order"}>
    <h3>{mode === "slot" ? "By insertion position" : "By solve order"}</h3>
    <p className="small faint">{mode === "slot" ? "Where each pair went in relative to how you held the cube, after any rotations" : "Pair completion order · skipped/XCross pairs counted separately"}</p>
    <p className="small faint">{RECOGNITION_NOTE}</p>
    {mode === "slot" && model.f2lInferredCount ? <p className="small faint">{model.f2lInferredCount} insertions were recorded without grip data and are inferred from the turns: the slot face turned most is taken as your R or L, so front-face or back-slot inserts may read as their mirror.</p> : null}
    {mode === "slot" && model.f2lUnassignedCount ? <p className="small faint">{model.f2lUnassignedCount} pairs have no known insertion position and are left out here; solve order includes them.</p> : null}
    {model.analysisCount ? <PerformanceTable rows={rows} labelHeader={mode === "slot" ? "Inserted at" : "Pair"} sort={sort} onSelect={(row) => setPosition((current) => current === row.label ? null : row.label)} expandedLabel={selected?.label} expanded={selected ? <div className="stats-detail" role="region" aria-label={mode === "slot" ? "F2L insertion position solves" : "F2L solve order solves"}>
      <div className="section-heading"><h3>{selected.label} · {selected.count} contributing solves</h3><button className="ghost" onClick={() => setPosition(null)}>Close pair</button></div>
      {selected.samples.length ? <div className="table-scroll"><table className="stats-table">
        <thead><tr><th>Pair time</th><th>Measured recognition</th><th>Measured execution</th><th>STM</th><th>Execution TPS</th><th>Solve time</th>{model.sessionId === null ? <th>Session</th> : null}<th>Date</th></tr></thead>
        <tbody>{selected.samples.map((sample) => {
          const solve = members.get(sample.solveId);
          return solve ? <tr key={sample.solveId} {...statisticsActivationProps(() => onOpenSolve(solve), `View solve ${formatSolveTime(solve)} · ${selected.label}`)}>
            <td>{formatTime(sample.timeMs)}</td><td>{formatTime(sample.recognitionMs)}</td><td>{formatTime(sample.executionMs)}</td><td>{sample.moves}</td><td>{sample.tps?.toFixed(2) ?? "—"}</td>
            <td><button className="ghost small stats-open-link" onClick={() => onOpenSolve(solve)}>{formatSolveTime(solve)}</button></td>
            {model.sessionId === null ? <td>{model.eventSessions.find((session) => session.id === solve.sessionId)?.name}</td> : null}<td>{date(solve.createdAt)}</td>
          </tr> : null;
        })}</tbody>
      </table></div> : <div className="chart-empty">No non-skipped samples for this position.</div>}
    </div> : undefined} /> : <div className="chart-empty">No usable CFOP analysis in this scope.</div>}
  </section>;
}

export function StatisticsF2lPerformance({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  return <StatsSection id="f2l" title="F2L performance">
    <div className="statistics-f2l-layout">
      <StatisticsF2lPerformancePanel mode="slot" model={model} onOpenSolve={onOpenSolve} />
      <StatisticsF2lPerformancePanel mode="order" model={model} onOpenSolve={onOpenSolve} />
    </div>
  </StatsSection>;
}

/** Raw source facts must cover the exact pair; analysis-only imports cannot supply them. */
function canPracticeRecordedPair(solve: Solve, step: SolveStep): boolean {
  return Boolean(effectiveCfopAnalysis(solve)?.crossFace && STEP_NAMES.slice(1, 5).includes(step.name) && !step.skipped && step.slot &&
    Number.isInteger(step.fromMove) && Number.isInteger(step.toMove) && step.fromMove >= 0 && step.toMove > step.fromMove &&
    solve.moves && solve.moves.length >= step.toMove && (solve.scrambledFacelets || solve.scramble.trim()));
}

function F2lCaseDiagram({ caseId }: { caseId: string }) {
  return <span className="stats-f2l-diagram" role="img" aria-label={`${caseId} canonical front-right case diagram`}>
    <F2lCaseThumbnail model={getF2lThumbnailModel("basic", caseId, "FR")} />
  </span>;
}

export function StatisticsF2lCaseTable({ model, onOpenSolve, onTrainCase, onPracticePair }: {
  model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void;
  onTrainCase: (family: TrainingFamily, caseId: string) => void;
  onPracticePair?: (solve: Solve, stepName: StepName) => void;
}) {
  const { date } = useDateTimeFormat();
  const sort = usePerformanceSort("case");
  const [caseId, setCaseId] = useState<string | null>(null);
  const rows = sortPerformanceRows(model.f2lCases, sort.column ?? "case", sort.direction);
  const selected = model.f2lCases.find(row => row.caseId === caseId);
  const members = new Map(model.scopeSolves.map(solve => [solve.id, solve]));
  const occurrenceCount = model.f2lCases.reduce((sum, row) => sum + row.count, 0);
  return <StatsSection id="f2l-cases" className="statistics-f2l-cases" title="F2L cases" description={`${model.f2lCases.length} recognised standard F2L cases · ${occurrenceCount} recognised pair occurrences · ${model.f2lUnrecognizedCount} unrecognised performed pairs · ${model.f2lSkippedCount} skipped/XCross pairs`}>
    <p className="small faint">Times describe the recorded pair step, including any setup before the standard case was recognised. They are not pure algorithm-execution measurements. Diagrams show the representative front-right case, not the historical insertion orientation.</p>
    <p className="small faint">{RECOGNITION_NOTE}</p>
    {model.f2lFocus.length ? <div className="focus-cases" role="group" aria-label="Worst F2L cases">
      {model.f2lFocus.map(({ reason, row }) => <div className="focus-case" key={reason}>
        <F2lCaseDiagram caseId={row.caseId} />
        <span className="stat-label">Worst {reason === "total" ? "total time" : reason}</span>
        <strong>{row.caseId}</strong>
        <strong className="mono">{reason === "total" ? "Total pair-step" : reason === "recognition" ? "Recognition" : "Execution"} {formatTime(reason === "total" ? row.medianMs : reason === "recognition" ? row.recognitionMs : row.executionMs)}</strong>
        <span className="small faint">Median total {formatTime(row.medianMs)} · Recognition {formatTime(row.recognitionMs)} · Execution {formatTime(row.executionMs)}</span>
        <span className="small faint">{row.count} pair occurrences</span>
        <div className="row"><button className="ghost small" onClick={() => setCaseId(row.caseId)}>View</button><button className="small" onClick={() => onTrainCase("f2l", row.caseId)}>Train</button></div>
      </div>)}
    </div> : <p className="small faint">Worst-case recommendations need at least 3 pair occurrences per case.</p>}
    {rows.length ? <PerformanceTable rows={rows} labelHeader="Case" sort={sort} hideSkips
      renderLabel={row => <span className="stats-f2l-case-label"><F2lCaseDiagram caseId={row.label} />{row.label}</span>}
      onSelect={row => setCaseId(current => current === row.label ? null : row.label)} expandedLabel={selected?.label}
      expanded={selected ? <div className="stats-detail" role="region" aria-label="F2L case pair occurrences">
        <div className="section-heading"><h3>{selected.caseId} · {selected.count} pair occurrences</h3><div className="row"><button onClick={() => onTrainCase("f2l", selected.caseId)}>Train case</button><button className="ghost" onClick={() => setCaseId(null)}>Close case</button></div></div>
        <div className="table-scroll"><table className="stats-table"><thead><tr><th>Pair order</th><th>Recorded position</th><th>Pair-step time</th><th>Measured recognition</th><th>Measured execution</th><th>STM</th><th>Execution TPS</th><th>Solve time</th>{model.sessionId === null ? <th>Session</th> : null}<th>Date</th><th>Actions</th></tr></thead>
          <tbody>{selected.samples.map(sample => {
            const solve = members.get(sample.solveId);
            const step = solve && effectiveCfopAnalysis(solve)?.steps.find(candidate => candidate.name === sample.stepName);
            if (!solve || !step) return null;
            const order = ["1st", "2nd", "3rd", "4th"][STEP_NAMES.indexOf(step.name) - 1];
            return <tr key={`${sample.solveId}:${step.name}`} {...statisticsActivationProps(() => onOpenSolve(solve), `Review solve ${formatSolveTime(solve)} · ${order} pair`)}>
              <td>{order} pair</td><td>{[step.slot ? `Cube slot ${step.slot}` : "", step.insertedAt ? `Inserted at ${step.insertedAt}${step.insertedAtSource === "inferred" ? " (inferred)" : ""}` : ""].filter(Boolean).join(" · ") || "—"}</td>
              <td>{formatTime(sample.timeMs)}</td><td>{formatTime(sample.recognitionMs)}</td><td>{formatTime(sample.executionMs)}</td><td>{sample.moves}</td><td>{sample.tps?.toFixed(2) ?? "—"}</td><td>{formatSolveTime(solve)}</td>
              {model.sessionId === null ? <td>{model.eventSessions.find(session => session.id === solve.sessionId)?.name}</td> : null}<td>{date(solve.createdAt)}</td>
              <td><button className="ghost small" onClick={() => onOpenSolve(solve)}>Review Solve</button>{onPracticePair && canPracticeRecordedPair(solve, step) ? <button className="small" onClick={() => onPracticePair(solve, step.name)}>Practice recorded pair</button> : null}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div> : undefined}
    /> : <div className="chart-empty">No recognised non-skipped standard F2L cases in this scope. Record solves with usable CFOP analysis to see pair occurrences.</div>}
  </StatsSection>;
}

export function StatisticsAnalysisTables({ model, onOpenSolve, onTrainCase, onPracticePair }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void; onTrainCase: (family: TrainingFamily, caseId: string) => void; onPracticePair?: (solve: Solve, stepName: StepName) => void }) {
  return <>
    <StatisticsF2lPerformance model={model} onOpenSolve={onOpenSolve} />
    <StatisticsF2lCaseTable model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} onPracticePair={onPracticePair} />
    <div className="statistics-case-layout">
    <StatisticsCaseTable family="oll" rows={model.ollCases} skipCount={model.ollSkips} focus={model.ollFocus} model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} />
    <StatisticsCaseTable family="pll" rows={model.pllCases} skipCount={model.pllSkips} focus={model.pllFocus} model={model} onOpenSolve={onOpenSolve} onTrainCase={onTrainCase} />
    </div>
  </>;
}

export function StatisticsPauses({ model, onOpenSolve }: { model: StatisticsViewModel; onOpenSolve: (solve: Solve) => void }) {
  const pauses = model.pauses;
  const longestSolve = model.scopeSolves.find((solve) => solve.id === pauses?.longest?.solveId);
  return (
    <StatsSection id="pauses" title="Pauses" description="Gaps ≥250 ms, attributed to the phase containing the next move. Pre-first-turn planning is unmeasured.">
      {pauses ? <>
        <div className="kpi-grid">
          <StatCard label="Pauses per solve" value={pauses.meanCount.toFixed(2)} detail={`${pauses.pauseCount} in ${pauses.sampleSize} analysed solves`} />
          <StatCard label="Typical pause" value={formatTime(pauses.meanDurationMs)} detail="Mean individual pause" />
          <StatCard label="Pause time per solve" value={formatTime(pauses.meanTotalMs)} detail="Mean total" />
          <StatCard label="Pause-free solves" value={`${(pauses.pauseFreeShare * 100).toFixed(1)}%`} detail={`${pauses.pauseFreeCount} / ${pauses.sampleSize}`} />
          <StatCard label="Longest pause" value={formatTime(pauses.longest?.durationMs)} onOpen={longestSolve ? () => onOpenSolve(longestSolve) : undefined}
            openLabel={longestSolve ? `View solve ${formatSolveTime(longestSolve)} with the longest pause` : undefined}
            detail={longestSolve ? `View solve ${formatSolveTime(longestSolve)}` : undefined} />
        </div>
        {pauses.pauseCount ? <SplitBar label="Pause time by phase" segments={pauses.phases.map((phase) => ({ series: `phase-${phase.name.toLowerCase()}`, label: phase.name, ms: phase.totalMs, share: phase.share }))} /> : null}
      </> : <div className="chart-empty">Pause analytics need usable CFOP analysis.</div>}
    </StatsSection>
  );
}

/** Spread of finished effective times; Best and Median themselves are shown in the summary. */
export function StatisticsConsistency({ model }: { model: StatisticsViewModel }) {
  const consistency = model.consistency;
  const rows: [string, string, string?][] = [
    ["Middle 50%", `${formatTime(consistency.p25Ms)} → ${formatTime(consistency.p75Ms)}`, "P25 → P75"],
    ["Middle 80%", `${formatTime(consistency.p10Ms)} → ${formatTime(consistency.p90Ms)}`, "P10 → P90"],
    ["Spread (IQR)", consistency.p25Ms === undefined || consistency.p75Ms === undefined ? "—" : formatTime(consistency.p75Ms - consistency.p25Ms)],
    ["PB vs median", formatTime(consistency.gapMs), consistency.gapShare === undefined ? undefined : `${(consistency.gapShare * 100).toFixed(1)}% of median`],
  ];
  return (
    <dl className="consistency-list" aria-label="Consistency">
      {rows.map(([label, value, detail]) => <div key={label}><dt>{label}{detail ? <small>{detail}</small> : null}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}
