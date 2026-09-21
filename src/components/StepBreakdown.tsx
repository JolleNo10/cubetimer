import { useMemo } from "react";
import type { SolveAnalysis, SolveStep } from "../cube/analysis";
import { faceColour, slotColours } from "../cube/colours";
import { ollGroupForCase } from "../cube/lastLayerCases";
import { formatTime } from "../state/stats";

export const STEP_COLORS: Record<string, string> = {
  Cross: "var(--blue)",
  "F2L Slot 1": "var(--accent)",
  "F2L Slot 2": "var(--accent)",
  "F2L Slot 3": "var(--accent)",
  "F2L Slot 4": "var(--accent)",
  OLL: "var(--amber)",
  PLL: "var(--violet)",
};

/**
 * Which step a position in the move stream falls in.
 *
 * A position sits *before* the move at that index, so landing exactly on a step's
 * first move means that step is about to happen, which is the one to highlight.
 * Skipped steps are never current: there is nothing to be in the middle of.
 */
export function stepAt(steps: readonly SolveStep[], index: number): number {
  const found = steps.findIndex(
    (step) => index >= step.fromMove && index < step.toMove,
  );
  if (found !== -1) return found;
  // Past the last move: the solve is finished, so the final step is the one shown.
  return index > 0 ? steps.length - 1 : 0;
}

/**
 * Split a case into the bit that identifies it and the bit that describes it.
 *
 * An OLL is a number, and its shape group is the hint. An F2L pair is named by the
 * colours of the slot it filled, with the export's own case label alongside it.
 */
function describeCase(step: SolveStep): { id: string; hint?: string } | null {
  const pair = step.slot ? slotColours(step.slot) : null;
  if (!step.case) return pair ? { id: pair } : null;
  const slots = /^(.*?)->(\S+)\s+(\S+)$/.exec(step.case);
  if (slots) {
    const from = slots[1].replace(/[[\]]/g, "").replace(",", "/");
    return { id: pair ?? slots[3], hint: pair ? slots[3] : `${from}→${slots[2]}` };
  }
  if (step.name === "OLL") {
    const group = ollGroupForCase(step.case);
    // "C" on its own is cryptic; "C shape" is what a cuber would say.
    const hint = group && group.length === 1 ? `${group} shape` : (group ?? undefined);
    return { id: step.case, hint };
  }
  if (pair) return { id: pair, hint: step.case };
  return { id: step.case };
}

function StepRow({
  step,
  total,
  active,
  onSelect,
}: {
  step: SolveStep;
  total: number;
  active: boolean;
  onSelect?: () => void;
}) {
  const width = (step.timeMs / total) * 100;
  const recognitionShare =
    step.timeMs > 0 ? (step.recognitionMs / step.timeMs) * 100 : 0;
  const described = describeCase(step);
  const isSkip = step.skipped || described?.id === "Solved";

  const content = (
    <>
      <span className="phase-head">
        <span className="phase-name">{step.name}</span>
        {described ? (
          <span className={`phase-case${isSkip ? " muted" : ""}`}>
            {described.id === "Solved" ? "skip" : described.id}
          </span>
        ) : step.skipped ? (
          <span className="phase-case muted">skip</span>
        ) : null}
        {described?.hint ? <span className="phase-hint">{described.hint}</span> : null}
      </span>
      <span className="phase-time">{formatTime(step.timeMs)}</span>
      <span className="phase-bar">
        <span
          className="recognition"
          style={{ width: `${(width * recognitionShare) / 100}%` }}
        />
        <span
          className="execution"
          style={{
            width: `${(width * (100 - recognitionShare)) / 100}%`,
            background: STEP_COLORS[step.name] ?? "var(--accent)",
          }}
        />
      </span>
      <span className="phase-sub">
        {step.sliceTurns} mv · {step.tps.toFixed(1)} tps
      </span>
    </>
  );

  if (!onSelect) {
    return (
      <div className="phase-row" title={step.moves || undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`phase-row selectable${active ? " active" : ""}`}
      title={step.moves ? `Jump to ${step.name}: ${step.moves}` : `Jump to ${step.name}`}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

/** Per-move time, coloured by step — the shape of a solve at a glance. */
function MoveGraph({
  analysis,
  position,
}: {
  analysis: SolveAnalysis;
  position?: number;
}) {
  const bars = useMemo(() => {
    const result: { gap: number; color: string; move: string }[] = [];
    let previous = 0;
    for (const step of analysis.steps) {
      const color = STEP_COLORS[step.name] ?? "var(--accent)";
      for (const { move, t } of step.recordedMoves) {
        result.push({ gap: Math.max(0, t - previous), color, move });
        previous = t;
      }
    }
    return result;
  }, [analysis]);

  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.gap), 1);

  return (
    <svg
      viewBox={`0 0 ${bars.length} 100`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 54, marginTop: 12, display: "block" }}
      role="img"
      aria-label="Time taken by each move"
    >
      {bars.map((bar, i) => {
        const height = Math.max(2, (bar.gap / max) * 100);
        return (
          <rect
            key={i}
            x={i + 0.15}
            y={100 - height}
            width={0.7}
            height={height}
            fill={bar.color}
            opacity={0.85}
          >
            <title>{`${bar.move} — ${Math.round(bar.gap)} ms`}</title>
          </rect>
        );
      })}
      {position !== undefined && position > 0 ? (
        <rect x={position - 0.1} y={0} width={0.2} height={100} fill="var(--text)" />
      ) : null}
    </svg>
  );
}

/**
 * The seven steps of a solve, with how long each took and what came up.
 *
 * Given `onSelectStep` the rows become buttons, which is how the replay lets you jump
 * to the moment a step began.
 */
export function StepBreakdown({
  analysis,
  activeStep,
  onSelectStep,
  showDetail = true,
  position,
}: {
  analysis: SolveAnalysis;
  activeStep?: number;
  onSelectStep?: (step: SolveStep) => void;
  showDetail?: boolean;
  position?: number;
}) {
  const total = Math.max(1, analysis.solvingMs);
  return (
    <>
      <div className="row small faint" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        <span>
          cross on{" "}
          <b className="dim" title={`${analysis.crossFace} face`}>
            <span
              className="colour-dot"
              style={{ background: faceColour(analysis.crossFace).hex }}
            />
            {faceColour(analysis.crossFace).name}
          </b>
        </span>
        <span className="grow" />
        <span title="Slice turn metric · quarter turn metric">
          {analysis.sliceTurns} STM · {analysis.quarterTurns} QTM
        </span>
        <span>{analysis.tps.toFixed(2)} tps</span>
      </div>

      {analysis.steps.map((step, i) => (
        <StepRow
          key={step.name}
          step={step}
          total={total}
          active={activeStep === i}
          onSelect={onSelectStep ? () => onSelectStep(step) : undefined}
        />
      ))}

      <div className="legend">
        <span>
          <i style={{ background: "color-mix(in oklab, var(--blue) 55%, transparent)" }} />
          recognition
        </span>
        <span>
          <i style={{ background: "var(--accent)" }} />
          execution
        </span>
        <span className="grow" />
        <span>
          {formatTime(analysis.totalRecognitionMs)} looking ·{" "}
          {formatTime(analysis.totalExecutionMs)} turning
        </span>
      </div>

      <MoveGraph analysis={analysis} position={position} />

      {showDetail && analysis.pauses.length > 0 ? (
        <div className="small faint" style={{ marginTop: 10 }}>
          {analysis.pauses.length} pause{analysis.pauses.length === 1 ? "" : "s"} over
          250&nbsp;ms, {formatTime(
            analysis.pauses.reduce((sum, p) => sum + p.durationMs, 0),
          )}
          s in total
          {analysis.turnsAfterSolution > 0
            ? ` · ${analysis.turnsAfterSolution} turns after the cube was solved`
            : ""}
        </div>
      ) : null}
    </>
  );
}
