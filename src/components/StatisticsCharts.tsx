import { formatTime } from "../state/stats";
import type { DistributionStats, PhaseTrendPoint, TrendPoint } from "../state/statistics";

const WIDTH = 1000;
const HEIGHT = 300;
const PAD = { top: 20, right: 24, bottom: 34, left: 64 };

function chartX(index: number, length: number): number {
  return PAD.left + (length <= 1 ? 0 : (WIDTH - PAD.left - PAD.right) * index / (length - 1));
}

function linePath(values: (number | null | undefined)[], max: number): string {
  let path = "";
  let active = false;
  values.forEach((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      active = false;
      return;
    }
    const x = chartX(index, values.length);
    const y = HEIGHT - PAD.bottom - (value / max) * (HEIGHT - PAD.top - PAD.bottom);
    path += `${active ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    active = true;
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

function yFor(value: number, max: number): number {
  return HEIGHT - PAD.bottom - (value / max) * (HEIGHT - PAD.top - PAD.bottom);
}

export function SolveTimeTrendChart({
  points,
  scopeLabel,
}: {
  points: TrendPoint[];
  scopeLabel: string;
}) {
  if (!points.length) return <div className="chart-empty">No counted solves in this scope yet.</div>;
  const finished = points.flatMap((point) => point.time === null ? [] : [point.time]);
  const rollingValues = points.flatMap((point) => [
    ...(typeof point.ao5 === "number" ? [point.ao5] : []),
    ...(typeof point.ao12 === "number" ? [point.ao12] : []),
  ]);
  const p95 = percentile(finished, 0.95) ?? 1;
  const maxValue = Math.max(p95 * 1.15, ...rollingValues, 1000);
  const ticks = [0, 0.5, 1].map((ratio) => maxValue * ratio);
  return (
    <div className="chart-shell">
      <svg
        className="stats-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Solve time trend for ${scopeLabel}`}
      >
        <title>{`Solve time, rolling averages, and personal bests — ${scopeLabel}`}</title>
        {ticks.map((value) => (
          <g key={value} className="chart-axis">
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(value, maxValue)} y2={yFor(value, maxValue)} />
            <text x={PAD.left - 10} y={yFor(value, maxValue) + 4} textAnchor="end">
              {formatTime(value)}
            </text>
          </g>
        ))}
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
        <path className="chart-line ao5" d={linePath(points.map((point) => point.ao5), maxValue)} />
        <path className="chart-line ao12" d={linePath(points.map((point) => point.ao12), maxValue)} />
        {points.map((point, index) => {
          const x = chartX(index, points.length);
          if (point.time === null) {
            return (
              <g key={point.id} className="chart-dnf" transform={`translate(${x},${HEIGHT - PAD.bottom - 8})`}>
                <title>{`${point.id}: DNF`}</title>
                <path d="M0,-8 L7,5 L-7,5 Z" />
              </g>
            );
          }
          const outlier = point.time > maxValue;
          const y = outlier ? PAD.top + 4 : yFor(point.time, maxValue);
          return (
            <g key={point.id} className={`chart-point${outlier ? " outlier" : point.isPb ? " pb" : ""}`}>
              <title>{`${point.id}: ${formatTime(point.time)}${point.isPb ? " — personal best" : ""}`}</title>
              {outlier ? <path d={`M${x},${y - 8} l7,9 h-14 z`} /> : <circle cx={x} cy={y} r={point.isPb ? 4 : 2.5} />}
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
  const values = points.flatMap((point) => [point.crossMs, point.f2lMs, point.ollMs, point.pllMs]);
  const maxValue = Math.max(...values, 1000) * 1.1;
  const series = [
    ["Cross", "crossMs", "cross"] as const,
    ["F2L", "f2lMs", "f2l"] as const,
    ["OLL", "ollMs", "oll"] as const,
    ["PLL", "pllMs", "pll"] as const,
  ];
  return (
    <div className="chart-shell">
      <svg className="stats-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`CFOP phase trend for ${scopeLabel}`}>
        <title>{`Smoothed CFOP phase times — ${scopeLabel}`}</title>
        {series.map(([, key, className]) => (
          <path key={key} className={`chart-line phase-${className}`} d={linePath(points.map((point) => point[key]), maxValue)} />
        ))}
        {series.map(([label, , className], index) => (
          <text key={label} className={`chart-legend-label phase-${className}`} x={WIDTH - PAD.right} y={PAD.top + 16 * index + 4} textAnchor="end">{label}</text>
        ))}
        <text className="chart-axis" x={PAD.left - 10} y={PAD.top + 4} textAnchor="end">{formatTime(maxValue)}</text>
        <text className="chart-axis" x={PAD.left - 10} y={HEIGHT - PAD.bottom + 4} textAnchor="end">0.00</text>
        <text className="chart-x-label" x={PAD.left} y={HEIGHT - 8}>older</text>
        <text className="chart-x-label" x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">newer</text>
      </svg>
    </div>
  );
}
