import { formatTime } from "../state/stats";
import type { AverageProgressionPoint, RecognitionTrendPoint, DistributionStats, PhaseTrendPoint, TrendPoint } from "../state/statistics";
import { statisticsActivationProps } from "./statisticsInteraction";

const WIDTH = 1000;
const HEIGHT = 300;
const PAD = { top: 20, right: 24, bottom: 34, left: 64 };

type TimeDomain = { min: number; max: number };

/** Visible finite values determine a padded domain; constant/empty series remain drawable. */
export function timeSeriesDomain(values: readonly (number | null | undefined)[]): TimeDomain {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return { min: 0, max: 1000 };
  const low = Math.min(...finite), high = Math.max(...finite);
  const padding = high === low ? Math.max(Math.abs(low) * 0.05, 100) : Math.max((high - low) * 0.08, 1);
  return { min: Math.max(0, low - padding), max: high + padding };
}

function TimeAxis({ domain }: { domain: TimeDomain }) {
  return <>{[0, 0.5, 1].map((ratio) => {
    const value = domain.min + ratio * (domain.max - domain.min);
    return <g className="chart-axis" key={ratio}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(value, domain)} y2={yFor(value, domain)} /><text x={PAD.left - 10} y={yFor(value, domain) + 4} textAnchor="end">{formatTime(value)}</text></g>;
  })}</>;
}

function TimeSeriesChart({ label, series, ids }: { label: string; series: { label: string; className: string; values: (number | null | undefined)[]; segmentKeys?: readonly string[] }[]; ids: string[] }) {
  const domain = timeSeriesDomain(series.flatMap((item) => item.values));
  return <div className="chart-shell"><svg className="stats-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} data-y-min={domain.min} data-y-max={domain.max}>
    <title>{label}</title>
    <TimeAxis domain={domain} />
    {series.map((item, index) => <g key={item.label}><path className={`chart-line ${item.className}`} d={linePath(item.values, domain, item.segmentKeys)} /><text className={`chart-legend-label ${item.className}`} x={WIDTH - PAD.right} y={PAD.top + index * 16 + 4} textAnchor="end">{item.label}</text>{item.values.map((value, point) => typeof value === "number" && Number.isFinite(value) ? <circle key={ids[point]} className={`chart-series-point ${item.className}`} cx={chartX(point, item.values.length)} cy={yFor(value, domain)} r="2"><title>{`${ids[point]} · ${item.label}: ${formatTime(value)}`}</title></circle> : null)}</g>)}
    <text className="chart-x-label" x={PAD.left} y={HEIGHT - 8}>older</text><text className="chart-x-label" x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">newer</text>
  </svg></div>;
}

export function AverageProgressionChart({ points, scopeLabel }: { points: AverageProgressionPoint[]; scopeLabel: string }) {
  if (!points.length) return <div className="chart-empty">An actual window of at least 5 counted solves is needed for average progression.</div>;
  const sessionIds = points.map((point) => point.sessionId);
  return <TimeSeriesChart label={`Actual rolling average progression for ${scopeLabel}`} ids={points.map((point) => point.solveId)} series={([5, 12, 50, 100] as const).map((size) => ({ label: `Ao${size}`, className: `ao${size}`, values: points.map((point) => point[`ao${size}`]), segmentKeys: sessionIds }))} />;
}

export function RecognitionExecutionTrendChart({ points, scopeLabel }: { points: RecognitionTrendPoint[]; scopeLabel: string }) {
  if (!points.length) return <div className="chart-empty">No analysed solves in this chart window.</div>;
  return <TimeSeriesChart label={`Measured recognition / execution trend for ${scopeLabel}`} ids={points.map((point) => point.solveId)} series={[
    { label: "Measured recognition", className: "recognition", values: points.map((point) => point.recognitionMs) },
    { label: "Measured execution", className: "execution", values: points.map((point) => point.executionMs) },
    { label: "Unclassified/opening time", className: "unclassified", values: points.map((point) => point.unclassifiedMs) },
  ]} />;
}

function chartX(index: number, length: number): number {
  return PAD.left + (length <= 1 ? 0 : (WIDTH - PAD.left - PAD.right) * index / (length - 1));
}

function linePath(values: (number | null | undefined)[], domain: TimeDomain, segmentKeys?: readonly string[]): string {
  let path = "";
  let active = false;
  let previousSegment: string | undefined;
  values.forEach((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      active = false;
      return;
    }
    const x = chartX(index, values.length);
    const y = yFor(value, domain);
    if (segmentKeys && segmentKeys[index] !== previousSegment) active = false;
    path += `${active ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    active = true;
    previousSegment = segmentKeys?.[index];
  });
  return path.trim();
}

function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function yFor(value: number, domain: TimeDomain): number {
  return HEIGHT - PAD.bottom - ((value - domain.min) / (domain.max - domain.min)) * (HEIGHT - PAD.top - PAD.bottom);
}

export function SolveTimeTrendChart({
  points,
  scopeLabel,
  onOpenSolve,
}: {
  points: TrendPoint[];
  scopeLabel: string;
  onOpenSolve?: (solveId: string) => void;
}) {
  if (!points.length) return <div className="chart-empty">No counted solves in this scope yet.</div>;
  const finished = points.flatMap((point) => typeof point.time === "number" && Number.isFinite(point.time) ? [point.time] : []);
  const rollingValues = points.flatMap((point) => [
    ...(typeof point.ao5 === "number" && Number.isFinite(point.ao5) ? [point.ao5] : []),
    ...(typeof point.ao12 === "number" && Number.isFinite(point.ao12) ? [point.ao12] : []),
  ]);
  let singlesForDomain = finished;
  if (finished.length >= 20) {
    const p5 = percentile(finished, 0.05)!;
    const p95 = percentile(finished, 0.95)!;
    singlesForDomain = finished.map((time) => Math.max(p5, Math.min(time, p95)));
  }
  const domain = timeSeriesDomain([...singlesForDomain, ...rollingValues]);
  const sessionIds = points.map((point) => point.sessionId);
  return (
    <div className="chart-shell">
      <svg
        className="stats-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role={onOpenSolve ? "group" : "img"}
        aria-label={`Solve time trend for ${scopeLabel}`}
        data-y-min={domain.min} data-y-max={domain.max}
      >
        <title>{`Solve time, rolling averages, and personal bests — ${scopeLabel}`}</title>
        <TimeAxis domain={domain} />
        {points.map((point, index) => index > 0 && point.sessionId !== points[index - 1].sessionId ? (
          <line
            key={`boundary-${point.id}`}
            className="chart-session-boundary"
            x1={chartX(index, points.length)}
            x2={chartX(index, points.length)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
          />
        ) : null)}
        <path className="chart-line ao5" d={linePath(points.map((point) => point.ao5), domain, sessionIds)} />
        <path className="chart-line ao12" d={linePath(points.map((point) => point.ao12), domain, sessionIds)} />
        {points.map((point, index) => {
          if (point.time !== null && !Number.isFinite(point.time)) return null;
          const x = chartX(index, points.length);
          const activation = statisticsActivationProps<SVGGElement>(onOpenSolve ? () => onOpenSolve(point.id) : undefined, `View solve ${formatTime(point.time)}${point.isPb ? " · personal best" : ""} · ${new Date(point.createdAt).toLocaleString()}`);
          if (point.time === null) {
            return (
              <g key={point.id} className="chart-dnf" transform={`translate(${x},${HEIGHT - PAD.bottom - 8})`} {...activation} role={onOpenSolve ? "button" : undefined}>
                <title>{`${point.id}: DNF`}</title>
                <path d="M0,-8 L7,5 L-7,5 Z" />
              </g>
            );
          }
          const outlierHigh = point.time > domain.max;
          const outlierLow = point.time < domain.min;
          const outlier = outlierHigh || outlierLow;
          const y = outlierHigh ? PAD.top + 4 : outlierLow ? HEIGHT - PAD.bottom : yFor(point.time, domain);
          return (
            <g key={point.id} className={`chart-point${outlier ? ` outlier${outlierLow ? " outlier-low" : ""}` : point.isPb ? " pb" : ""}`} {...activation} role={onOpenSolve ? "button" : undefined}>
              <title>{`${point.id}: ${formatTime(point.time)}${point.isPb ? " — personal best" : ""}`}</title>
              {outlier ? <path d={outlierLow ? `M${x},${y} l7,-9 h-14 z` : `M${x},${y - 8} l7,9 h-14 z`} /> : <circle cx={x} cy={y} r={point.isPb ? 4 : 2.5} />}
            </g>
          );
        })}
        <text className="chart-legend-label singles" x={WIDTH - PAD.right} y={PAD.top + 4} textAnchor="end">Singles</text>
        <text className="chart-legend-label ao5" x={WIDTH - PAD.right} y={PAD.top + 20} textAnchor="end">Ao5</text>
        <text className="chart-legend-label ao12" x={WIDTH - PAD.right} y={PAD.top + 36} textAnchor="end">Ao12</text>
        <text className="chart-x-label" x={PAD.left} y={HEIGHT - 8}>older</text>
        <text className="chart-x-label" x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">newer</text>
      </svg>
    </div>
  );
}

export function DistributionChart({ distribution }: { distribution: DistributionStats }) {
  if (distribution.status === "insufficient") {
    return <div className="chart-empty">At least three finished solves are needed for a distribution.</div>;
  }
  const maxCount = Math.max(...distribution.bins.map((bin) => bin.count), 1);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const zeroRange = distribution.minMs !== undefined && distribution.minMs === distribution.maxMs;
  const medianX = distribution.medianMs !== undefined && distribution.minMs !== undefined && distribution.maxMs !== undefined
    ? PAD.left + plotWidth * (zeroRange ? 0.5 : (distribution.medianMs - distribution.minMs) / (distribution.maxMs - distribution.minMs))
    : undefined;
  return (
    <div className="chart-shell">
      <svg className="stats-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Finished solve time distribution">
        <title>Finished solve time distribution</title>
        {distribution.bins.map((bin, index) => {
          const width = plotWidth / distribution.bins.length;
          const x = PAD.left + index * width + 1;
          const barHeight = bin.count / maxCount * plotHeight;
          return (
            <g key={`${bin.startMs}-${bin.endMs}`}>
              <title>{`${zeroRange ? formatTime(bin.startMs) : `${formatTime(bin.startMs)}–${formatTime(bin.endMs)}`}: ${bin.count} solves`}</title>
              <rect className="histogram-bar" x={x} y={HEIGHT - PAD.bottom - barHeight} width={Math.max(1, width - 2)} height={barHeight} />
              {index === 0 || index === distribution.bins.length - 1 ? (
                <text className="chart-axis" x={zeroRange ? PAD.left + plotWidth / 2 : x} y={HEIGHT - PAD.bottom + 18} textAnchor={zeroRange ? "middle" : "start"}>
                  {formatTime(index === 0 ? bin.startMs : bin.endMs)}
                </text>
              ) : null}
            </g>
          );
        })}
        {medianX !== undefined ? (
          <line
            className="chart-median"
            x1={medianX}
            x2={medianX}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
          />
        ) : null}
        <text className="chart-legend-label median" x={WIDTH - PAD.right} y={PAD.top + 4} textAnchor="end">Median</text>
        <text className="chart-x-label" x={WIDTH / 2} y={HEIGHT - 8} textAnchor="middle">Finished time</text>
      </svg>
    </div>
  );
}

export function CfopPhaseTrendChart({
  points,
  scopeLabel,
  emptyMessage = "No usable CFOP analysis in this scope.",
}: {
  points: PhaseTrendPoint[];
  scopeLabel: string;
  emptyMessage?: string;
}) {
  if (!points.length) return <div className="chart-empty">{emptyMessage}</div>;
  return <TimeSeriesChart label={`CFOP phase trend for ${scopeLabel}`} ids={points.map((point) => point.solveId)} series={([
    ["Cross", "crossMs", "cross"], ["F2L", "f2lMs", "f2l"], ["OLL", "ollMs", "oll"], ["PLL", "pllMs", "pll"],
  ] as const).map(([label, key, className]) => ({ label, className: `phase-${className}`, values: points.map((point) => point[key]) }))} />;
}
