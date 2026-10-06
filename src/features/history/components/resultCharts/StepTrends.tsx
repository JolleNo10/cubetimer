import type { SolveStep } from "../../../../cube/analysis";
import type { SolveComparison } from "../../../statistics/state/stats";
import { deltaClass, seconds, shortStep, signedSeconds, stepColour } from "./chartParts";

const W = 300;
const H = 30;

/**
 * Each step over the comparison solves and then this one, on its own scale, with the
 * middle half of those times shaded and their median dashed.
 */
export function StepTrends({ steps, comparison }: { steps: readonly SolveStep[]; comparison: SolveComparison | null }) {
  if (!comparison) return <div className="rc-empty small faint">Your trend appears after 3 comparable solves.</div>;
  return (
    <div className="rc-trends">
      {steps.map((step, index) => {
        const usual = comparison.steps[index];
        const series = [...usual.series, step.timeMs];
        const low = Math.min(...series), high = Math.max(...series);
        const y = (ms: number) => 3 + (high > low ? 1 - (ms - low) / (high - low) : 0.5) * (H - 6);
        const x = (i: number) => 2 + (i / (series.length - 1)) * (W - 10);
        const delta = step.timeMs - usual.baselineMs;
        return (
          <div className="rc-trend-row" key={step.name}>
            <span className="rc-trend-label">{shortStep(step.name)}</span>
            <span className="rc-trend-plot">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
              aria-label={`${step.name}: the last ${series.length - 1} comparable solves, then this one`}>
              <title>{`${step.name}: ${step.skipped ? "skipped" : `${seconds(step.timeMs)}s`} · usual ${seconds(usual.baselineMs)}s (middle half ${seconds(usual.p25Ms)}–${seconds(usual.p75Ms)}) over the last ${series.length - 1} comparable solves`}</title>
              <rect x={0} y={Math.min(y(usual.p75Ms), y(usual.p25Ms))} width={W} height={Math.max(1, Math.abs(y(usual.p25Ms) - y(usual.p75Ms)))} className="rc-trend-band" />
              <line x1={0} x2={W} y1={y(usual.baselineMs)} y2={y(usual.baselineMs)} className="rc-trend-median" />
              <polyline points={series.map((ms, i) => `${x(i).toFixed(1)},${y(ms).toFixed(1)}`).join(" ")} className="rc-trend-line" />
            </svg>
            {/* Drawn outside the stretched plot so it stays round. */}
            {!step.skipped ? (
              <span className="rc-trend-now" style={{ left: `${(x(series.length - 1) / W) * 100}%`, top: `${(y(step.timeMs) / H) * 100}%`, background: stepColour(step.name) }} />
            ) : null}
            </span>
            <span className={`rc-trend-delta mono small ${step.skipped ? "same" : deltaClass(delta)}`}>
              {step.skipped ? "skip" : signedSeconds(delta)}
            </span>
          </div>
        );
      })}
      <div className="rc-key small faint">older → this solve · shaded = your middle half · dashed = your median · each step on its own scale</div>
    </div>
  );
}
