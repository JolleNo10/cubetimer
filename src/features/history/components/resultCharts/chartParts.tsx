import type { SolveStep, StepName } from "../../../../cube/analysis";
import { formatTime } from "../../../../shared/time";
import { STEP_COLORS } from "../StepBreakdown";

/** Short names for marks, where the full step name would not fit. */
const SHORT: Record<StepName, string> = {
  Cross: "Cross",
  "F2L Slot 1": "F1",
  "F2L Slot 2": "F2",
  "F2L Slot 3": "F3",
  "F2L Slot 4": "F4",
  OLL: "OLL",
  PLL: "PLL",
};

export function shortStep(name: StepName): string {
  return SHORT[name];
}

/** Step colour; identity is never colour alone, every mark is labelled too. */
export function stepColour(name: StepName): string {
  return STEP_COLORS[name] ?? "var(--accent)";
}

/** The same colour, faded: recognising rather than turning. */
export function paleColour(name: StepName): string {
  return `color-mix(in oklab, ${stepColour(name)} 32%, transparent)`;
}

export function seconds(ms: number | null | undefined): string {
  return formatTime(ms ?? undefined);
}

export function signedSeconds(ms: number): string {
  return `${ms >= 0 ? "+" : "−"}${formatTime(Math.abs(ms))}`;
}

/** Faster is the accent, slower is amber, the same as the breakdown's "vs" column. */
export function deltaClass(ms: number): string {
  return Math.abs(ms) < 5 ? "same" : ms < 0 ? "faster" : "slower";
}

export function turnedSteps(steps: readonly SolveStep[]): SolveStep[] {
  return steps.filter((step) => !step.skipped && step.timeMs > 0);
}

/** A tidy step for axis ticks: 0.25, 0.5, 1, 2 or 5 seconds' worth of `unit`. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(max - min, 1e-9);
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? raw;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-6; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

/** A shared arrowhead, drawn in the dim text colour. */
export function ArrowMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" className="rc-arrowhead" />
      </marker>
    </defs>
  );
}

/** A line from `from` to just short of a mark of radius `stop` at `to`. */
export function arrowEnd(from: [number, number], to: [number, number], stop: number): [number, number] | null {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length <= stop + 4) return null;
  return [to[0] - (dx / length) * stop, to[1] - (dy / length) * stop];
}
