import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { percentile } from "../state/stats";
import type { AverageProgressionPoint, RecognitionTrendPoint, DistributionStats, PhaseTrendPoint, TrendPoint } from "../state/statistics";
import { statisticsActivationProps } from "./statisticsInteraction";
import { HEIGHT, PAD, WIDTH, chartX, dateTicks, linePath, segmentBoundaries, timeSeriesDomain, yFor, type TimeDomain } from "./chartGeometry";

export { timeSeriesDomain } from "./chartGeometry";

type LegendItem = { label: string; series: string; mark: "line" | "dashed" | "point" | "triangle" | "band" | "rule" };
type TooltipRow = { label: string; value: string; series?: string };
type Tooltip = { x: number; y: number; title: string; rows: TooltipRow[] };
type SessionNames = ReadonlyMap<string, string>;

/** The plot's rendered width, so one SVG unit is one CSS pixel and text keeps its size. */
function useChartWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(Math.max(280, Math.round(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function ChartFrame({ plotRef, legend, tooltip, width, children }: { plotRef: RefObject<HTMLDivElement | null>; legend: readonly LegendItem[]; tooltip: Tooltip | null; width: number; children: ReactNode }) {
  return (
    <div className="chart-shell">
      <ul className="chart-legend" aria-hidden="true">
        {legend.map((item) => <li key={item.label}><i className={`swatch ${item.mark} ${item.series}`} />{item.label}</li>)}
      </ul>
      <div className="chart-plot" ref={plotRef}>
        {children}
        {tooltip ? (
          <div className={`chart-tooltip${tooltip.x > width * 0.62 ? " flip" : ""}`} role="tooltip" style={{ left: tooltip.x, top: Math.min(HEIGHT - PAD.bottom - 24, Math.max(PAD.top + 24, tooltip.y)) }}>
            <strong>{tooltip.title}</strong>
            <dl>{tooltip.rows.map((row) => <div key={row.label}><dt>{row.series ? <i className={`swatch point ${row.series}`} /> : null}{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimeAxis({ domain, width }: { domain: TimeDomain; width: number }) {
  return <>{[0, 0.5, 1].map((ratio) => {
    const value = domain.min + ratio * (domain.max - domain.min);
    return <g className="chart-axis" key={ratio}><line x1={PAD.left} x2={width - PAD.right} y1={yFor(value, domain)} y2={yFor(value, domain)} /><text x={PAD.left - 10} y={yFor(value, domain) + 4} textAnchor="end">{formatTime(value)}</text></g>;
  })}</>;
}

function DateAxis({ createdAts, width }: { createdAts: readonly number[]; width: number }) {
  const { dateOnly } = useDateTimeFormat();
  const ticks = dateTicks(createdAts, dateOnly, Math.max(2, Math.floor((width - PAD.left - PAD.right) / 110)));
  return <g className="chart-x-tick">{ticks.map((tick) => {
    const x = chartX(tick.index, createdAts.length, width);
    const anchor = tick.index === 0 ? "start" : x > width - PAD.right - 50 ? "end" : "middle";
    return <g key={tick.index}><line x1={x} x2={x} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom + 4} /><text x={x} y={HEIGHT - 10} textAnchor={anchor}>{tick.label}</text></g>;
  })}</g>;
}

function SessionBoundaries({ keys, width }: { keys: readonly string[]; width: number }) {
  return <>{segmentBoundaries(keys).map((index) => {
    const x = chartX(index, keys.length, width);
    return <line key={`boundary-${index}`} className="chart-session-boundary" x1={x} x2={x} y1={PAD.top} y2={HEIGHT - PAD.bottom} />;
  })}</>;
}

function Crosshair({ x }: { x: number | undefined }) {
  return x === undefined ? null : <line className="chart-crosshair" x1={x} x2={x} y1={PAD.top} y2={HEIGHT - PAD.bottom} />;
}

type SeriesSpec = { label: string; series: string; values: readonly (number | null | undefined)[]; mark?: "line" | "dashed" };
type SolvePoint = { solveId: string; sessionId: string; createdAt: number; segmentKey: string };

function TimeSeriesChart({ label, series, points, onOpenSolve, sessionNames }: {
  label: string; series: readonly SeriesSpec[]; points: readonly SolvePoint[];
  onOpenSolve?: (solveId: string) => void; sessionNames?: SessionNames;
}) {
  const { date } = useDateTimeFormat();
  const [plotRef, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  const domain = timeSeriesDomain(series.flatMap((item) => item.values));
  const segmentKeys = points.map((point) => point.segmentKey);
  const step = points.length > 1 ? (width - PAD.left - PAD.right) / (points.length - 1) : 40;
  const hitWidth = Math.min(40, Math.max(4, step));
  const describe = (index: number) => series.map((item) => `${item.label} ${formatTime(item.values[index])}`).join(" · ");
  const activePoint = active === null ? undefined : points[active];
  const tooltip: Tooltip | null = activePoint && active !== null ? {
    x: chartX(active, points.length, width),
    y: Math.min(...series.map((item) => item.values[active]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).map((value) => yFor(value, domain)), HEIGHT - PAD.bottom),
    title: date(activePoint.createdAt),
    rows: [
      ...series.map((item) => ({ label: item.label, value: formatTime(item.values[active]), series: item.series })),
      ...(sessionNames ? [{ label: "Session", value: sessionNames.get(activePoint.sessionId) ?? "—" }] : []),
    ],
  } : null;
  return (
    <ChartFrame plotRef={plotRef} width={width} tooltip={tooltip} legend={series.map((item) => ({ label: item.label, series: item.series, mark: item.mark ?? "line" }))}>
      <svg className="stats-chart" viewBox={`0 0 ${width} ${HEIGHT}`} role={onOpenSolve ? "group" : "img"} aria-label={label} data-y-min={domain.min} data-y-max={domain.max}>
        <title>{label}</title>
        <TimeAxis domain={domain} width={width} />
        <DateAxis createdAts={points.map((point) => point.createdAt)} width={width} />
        <SessionBoundaries keys={segmentKeys} width={width} />
        <Crosshair x={active === null ? undefined : chartX(active, points.length, width)} />
        {series.map((item) => <g key={item.label}>
          <path className={`chart-line ${item.series}`} d={linePath(item.values, domain, segmentKeys, width)} />
          {item.values.map((value, index) => typeof value === "number" && Number.isFinite(value)
            ? <circle key={points[index].solveId} className={`chart-series-point ${item.series}`} cx={chartX(index, item.values.length, width)} cy={yFor(value, domain)} r={active === index ? 4 : 2} />
            : null)}
        </g>)}
        {points.map((point, index) => (
          <g key={point.solveId} className="chart-hit" data-solve-id={point.solveId} role={onOpenSolve ? "button" : undefined}
            {...statisticsActivationProps<SVGGElement>(onOpenSolve ? () => onOpenSolve(point.solveId) : undefined, `View solve · ${date(point.createdAt)} · ${describe(index)}`, { onEnter: () => setActive(index), onLeave: () => setActive(null) })}>
            <rect className="chart-hit-area" x={chartX(index, points.length, width) - hitWidth / 2} y={PAD.top} width={hitWidth} height={HEIGHT - PAD.top - PAD.bottom} />
          </g>
        ))}
      </svg>
    </ChartFrame>
  );
}

export function AverageProgressionChart({ points, scopeLabel, onOpenSolve, sessionNames }: { points: AverageProgressionPoint[]; scopeLabel: string; onOpenSolve?: (solveId: string) => void; sessionNames?: SessionNames }) {
  if (!points.length) return <div className="chart-empty">An actual window of at least 5 counted solves is needed for average progression.</div>;
  return <TimeSeriesChart label={`Actual rolling average progression for ${scopeLabel}`} points={points} onOpenSolve={onOpenSolve} sessionNames={sessionNames}
    series={([5, 12, 50, 100] as const).map((size) => ({ label: `Ao${size}`, series: `ao${size}`, mark: size === 12 || size === 100 ? "dashed" as const : "line" as const, values: points.map((point) => point[`ao${size}`]) }))} />;
}

export function RecognitionExecutionTrendChart({ points, scopeLabel, onOpenSolve, sessionNames }: { points: RecognitionTrendPoint[]; scopeLabel: string; onOpenSolve?: (solveId: string) => void; sessionNames?: SessionNames }) {
  if (!points.length) return <div className="chart-empty">No analysed solves in this chart window.</div>;
  return <TimeSeriesChart label={`Measured recognition / execution trend for ${scopeLabel}`} points={points} onOpenSolve={onOpenSolve} sessionNames={sessionNames} series={[
    { label: "Recognition", series: "recognition", values: points.map((point) => point.recognitionMs) },
    { label: "Execution", series: "execution", values: points.map((point) => point.executionMs) },
    { label: "Unclassified", series: "unclassified", mark: "dashed", values: points.map((point) => point.unclassifiedMs) },
  ]} />;
}

export function CfopPhaseTrendChart({ points, scopeLabel, emptyMessage = "No usable CFOP analysis in this scope.", onOpenSolve, sessionNames }: {
  points: PhaseTrendPoint[]; scopeLabel: string; emptyMessage?: string; onOpenSolve?: (solveId: string) => void; sessionNames?: SessionNames;
}) {
  if (!points.length) return <div className="chart-empty">{emptyMessage}</div>;
  return <TimeSeriesChart label={`CFOP phase trend for ${scopeLabel}`} points={points} onOpenSolve={onOpenSolve} sessionNames={sessionNames} series={([
    ["Cross", "crossMs", "cross"], ["F2L", "f2lMs", "f2l"], ["OLL", "ollMs", "oll"], ["PLL", "pllMs", "pll"],
  ] as const).map(([label, key, phase]) => ({ label, series: `phase-${phase}`, values: points.map((point) => point[key]) }))} />;
}

export function SolveTimeTrendChart({
  points,
  scopeLabel,
  onOpenSolve,
  sessionNames,
}: {
  points: TrendPoint[];
  scopeLabel: string;
  onOpenSolve?: (solveId: string) => void;
  sessionNames?: SessionNames;
}) {
  const { date } = useDateTimeFormat();
  const [plotRef, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
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
  const x = (index: number) => chartX(index, points.length, width);
  const activePoint = active === null ? undefined : points[active];
  const tooltip: Tooltip | null = activePoint && active !== null ? {
    x: x(active),
    y: activePoint.time === null || !Number.isFinite(activePoint.time) ? HEIGHT - PAD.bottom - 8 : Math.max(PAD.top, Math.min(HEIGHT - PAD.bottom, yFor(activePoint.time, domain))),
    title: date(activePoint.createdAt),
    rows: [
      { label: activePoint.isPb ? "Single · PB" : "Single", value: formatTime(activePoint.time), series: activePoint.time === null ? "dnf" : activePoint.isPb ? "pb" : "singles" },
      { label: "Ao5", value: formatTime(activePoint.ao5), series: "ao5" },
      { label: "Ao12", value: formatTime(activePoint.ao12), series: "ao12" },
      ...(sessionNames ? [{ label: "Session", value: sessionNames.get(activePoint.sessionId) ?? "—" }] : []),
    ],
  } : null;
  const legend: LegendItem[] = [
    { label: "Singles", series: "singles", mark: "point" }, { label: "PB", series: "pb", mark: "point" },
    { label: "Ao5", series: "ao5", mark: "line" }, { label: "Ao12", series: "ao12", mark: "dashed" },
    ...(points.some((point) => point.time === null) ? [{ label: "DNF", series: "dnf", mark: "triangle" as const }] : []),
  ];
  return (
    <ChartFrame plotRef={plotRef} width={width} tooltip={tooltip} legend={legend}>
      <svg
        className="stats-chart"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role={onOpenSolve ? "group" : "img"}
        aria-label={`Solve time trend for ${scopeLabel}`}
        data-y-min={domain.min} data-y-max={domain.max}
      >
        <title>{`Solve time, rolling averages, and personal bests — ${scopeLabel}`}</title>
        <TimeAxis domain={domain} width={width} />
        <DateAxis createdAts={points.map((point) => point.createdAt)} width={width} />
        {points.map((point, index) => index > 0 && point.sessionId !== points[index - 1].sessionId ? (
          <line key={`boundary-${point.id}`} className="chart-session-boundary" x1={x(index)} x2={x(index)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
        ) : null)}
        <Crosshair x={active === null ? undefined : x(active)} />
        <path className="chart-line ao5" d={linePath(points.map((point) => point.ao5), domain, sessionIds, width)} />
        <path className="chart-line ao12" d={linePath(points.map((point) => point.ao12), domain, sessionIds, width)} />
        {points.map((point, index) => {
          if (point.time !== null && !Number.isFinite(point.time)) return null;
          const activation = statisticsActivationProps<SVGGElement>(
            onOpenSolve ? () => onOpenSolve(point.id) : undefined,
            `View solve ${formatTime(point.time)}${point.isPb ? " · personal best" : ""} · ${date(point.createdAt)}`,
            { onEnter: () => setActive(index), onLeave: () => setActive(null) },
          );
          if (point.time === null) {
            return (
              <g key={point.id} className="chart-dnf" data-solve-id={point.id} transform={`translate(${x(index)},${HEIGHT - PAD.bottom - 8})`} {...activation} role={onOpenSolve ? "button" : undefined}>
                <circle className="chart-hit-area" r="9" />
                <path d="M0,-8 L7,5 L-7,5 Z" />
              </g>
            );
          }
          const outlierHigh = point.time > domain.max;
          const outlierLow = point.time < domain.min;
          const outlier = outlierHigh || outlierLow;
          const y = outlierHigh ? PAD.top + 4 : outlierLow ? HEIGHT - PAD.bottom : yFor(point.time, domain);
          return (
            <g key={point.id} className={`chart-point${outlier ? ` outlier${outlierLow ? " outlier-low" : ""}` : point.isPb ? " pb" : ""}`} data-solve-id={point.id} {...activation} role={onOpenSolve ? "button" : undefined}>
              {outlier ? <path d={outlierLow ? `M${x(index)},${y} l7,-9 h-14 z` : `M${x(index)},${y - 8} l7,9 h-14 z`} /> : <circle cx={x(index)} cy={y} r={point.isPb ? 4 : active === index ? 4 : 2.5} />}
              <circle className="chart-hit-area" cx={x(index)} cy={outlierLow ? y - 4 : outlierHigh ? y - 4 : y} r="8" />
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export function DistributionChart({ distribution, band }: { distribution: DistributionStats; band?: { p25Ms?: number; p75Ms?: number } }) {
  const [plotRef, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  if (distribution.status === "insufficient") {
    return <div className="chart-empty">At least three finished solves are needed for a distribution.</div>;
  }
  const maxCount = Math.max(...distribution.bins.map((bin) => bin.count), 1);
  const total = distribution.bins.reduce((sum, bin) => sum + bin.count, 0);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const plotWidth = width - PAD.left - PAD.right;
  const zeroRange = distribution.minMs !== undefined && distribution.minMs === distribution.maxMs;
  const position = (ms: number) => PAD.left + plotWidth * (zeroRange ? 0.5 : (ms - distribution.minMs!) / (distribution.maxMs! - distribution.minMs!));
  const medianX = distribution.medianMs !== undefined && distribution.minMs !== undefined && distribution.maxMs !== undefined ? position(distribution.medianMs) : undefined;
  const showBand = !zeroRange && band?.p25Ms !== undefined && band.p75Ms !== undefined;
  const binWidth = plotWidth / distribution.bins.length;
  const label = (bin: DistributionStats["bins"][number]) => zeroRange ? formatTime(bin.startMs) : `${formatTime(bin.startMs)}–${formatTime(bin.endMs)}`;
  const activeBin = active === null ? undefined : distribution.bins[active];
  const tooltip: Tooltip | null = activeBin && active !== null ? {
    x: PAD.left + active * binWidth + binWidth / 2,
    y: HEIGHT - PAD.bottom - activeBin.count / maxCount * plotHeight,
    title: label(activeBin),
    rows: [{ label: "Solves", value: String(activeBin.count) }, { label: "Share", value: `${total ? Math.round(activeBin.count / total * 100) : 0}%` }],
  } : null;
  const legend: LegendItem[] = [{ label: "Median", series: "median", mark: "rule" }, ...(showBand ? [{ label: "Middle 50%", series: "band", mark: "band" as const }] : [])];
  return (
    <ChartFrame plotRef={plotRef} width={width} tooltip={tooltip} legend={legend}>
      <svg className="stats-chart" viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-label="Finished solve time distribution">
        <title>Finished solve time distribution</title>
        {showBand ? <rect className="distribution-band" x={position(band.p25Ms!)} y={PAD.top} width={Math.max(1, position(band.p75Ms!) - position(band.p25Ms!))} height={plotHeight} /> : null}
        {distribution.bins.map((bin, index) => {
          const x = PAD.left + index * binWidth + 1;
          const barHeight = bin.count / maxCount * plotHeight;
          return (
            <g key={`${bin.startMs}-${bin.endMs}`} className="histogram-bin" tabIndex={0} role="img" aria-label={`${label(bin)}: ${bin.count} solves`}
              onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
              <rect className="chart-hit-area" x={x - 1} y={PAD.top} width={binWidth} height={plotHeight} />
              <rect className={`histogram-bar${active === index ? " active" : ""}`} x={x} y={HEIGHT - PAD.bottom - barHeight} width={Math.max(1, binWidth - 2)} height={barHeight} />
              {index === 0 || index === distribution.bins.length - 1 ? (
                <text className="chart-axis" x={zeroRange ? PAD.left + plotWidth / 2 : index === 0 ? x : x + binWidth - 2} y={HEIGHT - PAD.bottom + 18} textAnchor={zeroRange ? "middle" : index === 0 ? "start" : "end"}>
                  {formatTime(index === 0 ? bin.startMs : bin.endMs)}
                </text>
              ) : null}
            </g>
          );
        })}
        {medianX !== undefined ? <line className="chart-median" x1={medianX} x2={medianX} y1={PAD.top} y2={HEIGHT - PAD.bottom} /> : null}
        {medianX !== undefined && !zeroRange ? <text className="chart-median-label" x={medianX + 4} y={PAD.top + 10}>{formatTime(distribution.medianMs)}</text> : null}
      </svg>
    </ChartFrame>
  );
}
