import type { SolveStep } from "../../../../cube/analysis";
import type { SolveComparison } from "../../../statistics/state/stats";
import { deltaClass, seconds, shortStep, signedSeconds, stepColour } from "./chartParts";

const BAR = 220;
const SPARK = 90;

/**
 * Each step against your usual: the bar is this solve, the band is the middle half of
 * your recent times, the tick is their median, and the line beside it is how they went.
 */
export function StepBullets({ steps, comparison }: { steps: readonly SolveStep[]; comparison: SolveComparison | null }) {
  const scaleMax = Math.max(1, ...steps.map((step, index) => {
    const usual = comparison?.steps[index];
    return Math.max(step.timeMs, usual?.p75Ms ?? 0, usual?.baselineMs ?? 0);
  })) * 1.05;
  const x = (ms: number) => (ms / scaleMax) * BAR;

  return (
    <div className="rc-bullets" role="img" aria-label="Each step's time against your usual range">
      {steps.map((step, index) => {
        const usual = comparison?.steps[index];
        const series = usual && !step.skipped ? [...usual.series, step.timeMs] : [];
        const low = Math.min(...series), high = Math.max(...series);
        const sparkY = (ms: number) => 3 + (high > low ? (1 - (ms - low) / (high - low)) : 0.5) * 14;
        const delta = usual ? step.timeMs - usual.baselineMs : null;
        return (
          <div className="rc-bullet-row" key={step.name}>
            <span className="rc-row-label">{shortStep(step.name)}</span>
            <svg className="rc-bullet" viewBox={`0 0 ${BAR} 22`} preserveAspectRatio="none">
              <title>{step.skipped
                ? `${step.name}: skipped`
                : `${step.name}: ${seconds(step.timeMs)}s${usual ? ` · usual ${seconds(usual.baselineMs)}s (middle half ${seconds(usual.p25Ms)}–${seconds(usual.p75Ms)})` : ""}`}</title>
              <rect x={0} y={3} width={BAR} height={16} rx={4} className="rc-track" />
              {usual ? <rect x={x(usual.p25Ms)} y={3} width={Math.max(1, x(usual.p75Ms) - x(usual.p25Ms))} height={16} rx={3} className="rc-band" /> : null}
              {!step.skipped ? <rect x={0} y={8.5} width={x(step.timeMs)} height={5} rx={2.5} fill={stepColour(step.name)} /> : null}
              {usual ? <line x1={x(usual.baselineMs)} x2={x(usual.baselineMs)} y1={1} y2={21} className="rc-median" /> : null}
            </svg>
            <span className={`rc-delta mono small ${delta === null || step.skipped ? "same" : deltaClass(delta)}`}>
              {step.skipped ? "skip" : delta === null ? seconds(step.timeMs) : signedSeconds(delta)}
            </span>
            {series.length > 1 ? (
              <svg className="rc-spark" viewBox={`0 0 ${SPARK} 20`} width={SPARK} height={20}>
                <title>{`${step.name}: the last ${series.length - 1} comparable solves, then this one`}</title>
                <polyline points={series.map((ms, i) => `${(i / (series.length - 1)) * (SPARK - 5)},${sparkY(ms)}`).join(" ")} className="rc-spark-line" />
                <circle cx={SPARK - 5} cy={sparkY(step.timeMs)} r={3} fill={stepColour(step.name)} />
              </svg>
            ) : <span className="rc-spark" />}
          </div>
        );
      })}
      <div className="rc-key small faint">
        {comparison
          ? "bar = this solve · tick = your median · band = your middle half · line = recent trend"
          : "Your usual range appears after 3 comparable solves."}
      </div>
    </div>
  );
}
