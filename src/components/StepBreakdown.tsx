import { useMemo, useState } from "react";
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

export type StepTimeScale = {
  maxMs: number;
  tickMs: number;
  ticks: number[];
};

const NICE_INTERVALS = [1, 2, 2.5, 5];

/** Choose one shared, human-readable linear scale for all step timing bars. */
export function stepTimeScale(steps: readonly SolveStep[]): StepTimeScale {
  const slowestMs = Math.max(0, ...steps.map((step) => step.timeMs));
  if (slowestMs === 0) return buildStepTimeScale(100, 500);

  const order = Math.floor(Math.log10(slowestMs));
  const candidates = [...new Set(
    Array.from({ length: 5 }, (_, offset) => order - 2 + offset).flatMap((exponent) =>
      NICE_INTERVALS.map((interval) => interval * 10 ** exponent),
    ),
  )].sort((a, b) => a - b);
  const firstAcceptable = candidates.find((tickMs) => Math.ceil(slowestMs / tickMs) <= 7);
  const firstIntervals = firstAcceptable
    ? Math.ceil(slowestMs / firstAcceptable)
    : undefined;
  const tickMs = firstIntervals === 6
    ? candidates.find((candidate) => Math.ceil(slowestMs / candidate) === 5) ?? firstAcceptable
    : firstAcceptable;
  const selectedTickMs = tickMs ?? candidates[candidates.length - 1];
  return buildStepTimeScale(selectedTickMs, Math.ceil(slowestMs / selectedTickMs) * selectedTickMs);
}

function buildStepTimeScale(tickMs: number, maxMs: number): StepTimeScale {
  const ticks = Array.from({ length: Math.max(1, Math.ceil(maxMs / tickMs)) }, (_, i) =>
    (i + 1) * tickMs,
  );
  return { maxMs: ticks[ticks.length - 1], tickMs, ticks };
}

function scalePositionPercent(tick: number, scale: StepTimeScale): number {
  return (tick / scale.maxMs) * 100;
}

export function stepBarWidths(
  step: SolveStep,
  total: number,
  timeScale?: StepTimeScale,
): { recognitionWidth: number; executionWidth: number } {
  if (step.timeMs <= 0) return { recognitionWidth: 0, executionWidth: 0 };

  const totalWidth = timeScale
    ? (step.timeMs / timeScale.maxMs) * 100
    : (step.timeMs / total) * 100;
  const recognitionWidth = timeScale
    ? (step.recognitionMs / timeScale.maxMs) * 100
    : (totalWidth * (step.timeMs > 0 ? (step.recognitionMs / step.timeMs) * 100 : 0)) / 100;
  const executionWidth = timeScale
    ? (step.executionMs / timeScale.maxMs) * 100
    : totalWidth - recognitionWidth;
  return { recognitionWidth, executionWidth };
}

/** Format a scale label without trailing zeroes: `500` → `0.5s`, `1000` → `1s`. */
export function formatScaleSeconds(ms: number): string {
  const seconds = ms / 1000;
  const decimals = seconds >= 0.1 ? 2 : 3;
  return `${seconds.toFixed(decimals).replace(/\.?0+$/, "")}s`;
}

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
  showMoves,
  showSplitTimes,
  timeScale,
  onSelect,
}: {
  step: SolveStep;
  total: number;
  active: boolean;
  showMoves: boolean;
  showSplitTimes: boolean;
  timeScale?: StepTimeScale;
  onSelect?: () => void;
}) {
  const { recognitionWidth, executionWidth } = stepBarWidths(step, total, timeScale);
  const described = describeCase(step);
  const isSkip = step.skipped || described?.id === "Solved";

  const splitValues = showSplitTimes ? (
    <>
      <span
        className="phase-split-value recognition-value"
        title={step.name === "Cross" ? "Cross recognition before the first turn is not timed." : "Time spent recognizing this step"}
        aria-label={step.name === "Cross" ? "Recognition not measured" : `Recognition ${formatTime(step.recognitionMs)}`}
      >
        {step.name === "Cross" ? "—" : formatTime(step.recognitionMs)}
      </span>
      <span
        className="phase-split-value execution-value"
        aria-label={`Execution ${formatTime(step.executionMs)}`}
      >
        {formatTime(step.executionMs)}
      </span>
      <span className="phase-split-value moves-value" aria-label={`${step.sliceTurns} moves`}>
        {step.sliceTurns}
      </span>
      <span className="phase-split-value tps-value" aria-label={`${step.tps.toFixed(1)} TPS`}>
        {step.tps.toFixed(1)}
      </span>
    </>
  ) : null;

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
      {splitValues}
      <span className="phase-bar">
        {timeScale ? (
          <span
            className="phase-time-guides"
            aria-hidden="true"
            data-scale-max-ms={timeScale.maxMs}
            data-tick-ms={timeScale.tickMs}
          >
            {timeScale.ticks.map((tick, index) => (
              <i
                key={tick}
                style={{
                  left: `${scalePositionPercent(tick, timeScale)}%`,
                  transform: index === timeScale.ticks.length - 1 ? "translateX(-100%)" : undefined,
                }}
              />
            ))}
          </span>
        ) : null}
        <span
          className="recognition"
          style={{ width: `${recognitionWidth}%` }}
        />
        <span
          className="execution"
          style={{
            width: `${executionWidth}%`,
            background: STEP_COLORS[step.name] ?? "var(--accent)",
          }}
        />
      </span>
      <span className="phase-sub">
        {step.sliceTurns} mv · {step.tps.toFixed(1)} tps
      </span>
      {showMoves && step.moves ? (
        <span className="phase-moves mono">{step.moves}</span>
      ) : null}
    </>
  );

  if (!onSelect) {
    return <div className="phase-row">{content}</div>;
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

function TimeScaleAxis({ scale }: { scale: StepTimeScale }) {
  return (
    <div
      className="phase-time-axis"
      aria-label="Step time scale"
      data-scale-max-ms={scale.maxMs}
      data-tick-ms={scale.tickMs}
    >
      {scale.ticks.map((tick, index) => (
        <span
          key={tick}
          className={`phase-time-axis-label${index === scale.ticks.length - 1 ? " last" : ""}`}
          style={{ left: `${scalePositionPercent(tick, scale)}%` }}
        >
          {formatScaleSeconds(tick)}
        </span>
      ))}
    </div>
  );
}

function Solution({ solution }: { solution: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="solution">
      <div className="row">
        <span className="panel-title">Solution</span>
        <span className="grow" />
        <button
          className="ghost small"
          onClick={() => {
            void navigator.clipboard?.writeText(solution);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div className="mono solution-moves">{solution}</div>
    </div>
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
/**
 * The solve written out.
 *
 * Joining the steps gives the solution as the solver turned it, in the frame they held
 * the cube in — the leading rotation included, since without it the moves would refer
 * to the wrong faces.
 */
export function fullSolution(analysis: SolveAnalysis): string {
  return analysis.steps
    .map((step) => step.moves)
    .filter((moves) => moves.length > 0)
    .join(" ");
}

export function StepBreakdown({
  analysis,
  activeStep,
  onSelectStep,
  showDetail = true,
  showMoves = true,
  showSplitTimes = false,
  showTimeScale = false,
  position,
}: {
  analysis: SolveAnalysis;
  activeStep?: number;
  onSelectStep?: (step: SolveStep) => void;
  showDetail?: boolean;
  showMoves?: boolean;
  showSplitTimes?: boolean;
  showTimeScale?: boolean;
  position?: number;
}) {
  const total = Math.max(1, analysis.solvingMs);
  const timeScale = showTimeScale ? stepTimeScale(analysis.steps) : undefined;
  const solution = fullSolution(analysis);
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

      {timeScale ? <TimeScaleAxis scale={timeScale} /> : null}

      {analysis.steps.map((step, i) => (
        <StepRow
          key={step.name}
          step={step}
          total={total}
          active={activeStep === i}
          showMoves={showMoves}
          showSplitTimes={showSplitTimes}
          timeScale={timeScale}
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
          {formatTime(analysis.totalRecognitionMs)} {showTimeScale ? "measured recognition" : "looking"} ·{" "}
          {formatTime(analysis.totalExecutionMs)} {showTimeScale ? "execution" : "turning"}
        </span>
      </div>

      {showMoves && solution ? <Solution solution={solution} /> : null}

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
