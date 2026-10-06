import { useId } from "react";
import type { SolveStep } from "../../../../cube/analysis";
import type { ResultScatter } from "../../../../app/types";
import type { SolveComparison, StepComparison } from "../../../statistics/state/stats";
import { ArrowMarker, arrowEnd, niceTicks, seconds, shortStep, stepColour, turnedSteps } from "./chartParts";

const W = 420;
const H = 300;
const LEFT = 46;
const BOTTOM = 38;
const TOP = 12;
const RIGHT = 14;

type Mode = {
  label: string;
  x: (step: SolveStep) => number;
  y: (step: SolveStep) => number;
  usualX: (usual: StepComparison) => number | null;
  usualY: (usual: StepComparison) => number | null;
  xAxis: string;
  yAxis: string;
  xTick: (value: number) => string;
  /** Steps this view can say something about. */
  include: (step: SolveStep) => boolean;
};

const MODES: Record<ResultScatter, Mode> = {
  recexec: {
    label: "Recognition against execution",
    x: (step) => step.recognitionMs,
    y: (step) => step.executionMs,
    usualX: (usual) => usual.medianRecognitionMs,
    usualY: (usual) => usual.medianExecutionMs,
    xAxis: "recognition (s) →",
    yAxis: "execution (s) →",
    xTick: (value) => seconds(value),
    include: () => true,
  },
  speed: {
    label: "Turning speed against execution time",
    x: (step) => step.tps,
    y: (step) => step.executionMs,
    usualX: (usual) => usual.medianTps,
    usualY: (usual) => usual.medianExecutionMs,
    xAxis: "turning speed (TPS)   slow → fast",
    yAxis: "execution (s) →",
    xTick: (value) => value.toFixed(value < 10 ? 1 : 0),
    include: (step) => step.tps > 0,
  },
  thinkturn: {
    label: "Turning speed against recognition",
    x: (step) => step.tps,
    y: (step) => step.recognitionMs,
    usualX: (usual) => usual.medianTps,
    usualY: (usual) => usual.medianRecognitionMs,
    xAxis: "turning speed (TPS)   slow → fast",
    yAxis: "recognition (s) →",
    xTick: (value) => value.toFixed(value < 10 ? 1 : 0),
    // The cross is planned before the first turn, so its recognition is not measured.
    include: (step) => step.tps > 0 && step.name !== "Cross",
  },
};

function span(values: number[], floorAtZero: boolean): [number, number] {
  const low = Math.min(...values), high = Math.max(...values);
  const pad = Math.max((high - low) * 0.12, high * 0.05, 1e-3);
  return [floorAtZero ? Math.max(0, low - pad) : low - pad, high + pad];
}

/**
 * Each step as a dot, with a faint arrow from where your usual puts it. Three views of
 * the same question: what kind of slow was it?
 */
export function StepScatter({ steps, comparison, mode }: {
  steps: readonly SolveStep[];
  comparison: SolveComparison | null;
  mode: ResultScatter;
}) {
  const marker = `rc-arrow-${useId().replaceAll(":", "")}`;
  const view = MODES[mode];
  const points = turnedSteps(steps).filter(view.include).map((step) => {
    const usual = comparison?.steps[steps.indexOf(step)];
    const ux = usual ? view.usualX(usual) : null, uy = usual ? view.usualY(usual) : null;
    return { step, x: view.x(step), y: view.y(step), usual: ux !== null && uy !== null ? { x: ux, y: uy } : null };
  });
  if (points.length === 0) return <div className="rc-empty small faint">No turned steps to plot.</div>;

  const xs = points.flatMap((p) => (p.usual ? [p.x, p.usual.x] : [p.x]));
  const ys = points.flatMap((p) => (p.usual ? [p.y, p.usual.y] : [p.y]));
  const [x0, x1] = span(xs, true), [y0, y1] = span(ys, true);
  const px = (value: number) => LEFT + ((value - x0) / (x1 - x0)) * (W - LEFT - RIGHT);
  const py = (value: number) => H - BOTTOM - ((value - y0) / (y1 - y0)) * (H - BOTTOM - TOP);
  const plotted = placeLabels(points.map((p) => ({ ...p, cx: px(p.x), cy: py(p.y), r: 4 + Math.min(p.step.sliceTurns, 20) * 0.3 })));

  // Thinking against turning splits into four corners at your usual.
  const corners = mode === "thinkturn" ? (() => {
    const usuals = points.flatMap((p) => (p.usual ? [p.usual] : []));
    const pool = usuals.length ? usuals : points;
    const midX = pool.reduce((sum, p) => sum + p.x, 0) / pool.length;
    const midY = pool.reduce((sum, p) => sum + p.y, 0) / pool.length;
    return { x: px(midX), y: py(midY) };
  })() : null;

  // Execution time is moves over speed, so equal move counts are curves on that view.
  const moveCurves = mode === "speed" ? niceTicks(
    Math.min(...points.map((p) => p.step.sliceTurns)) * 0.8,
    Math.max(...points.map((p) => p.step.sliceTurns)) * 1.2,
    4,
  ).map(Math.round).filter((moves, i, all) => moves > 0 && all.indexOf(moves) === i).map((moves) => {
    const path = Array.from({ length: 48 }, (_, i) => {
      const tps = x0 + ((x1 - x0) * i) / 47;
      return tps > 0 ? [px(tps), py((moves / tps) * 1000)] as const : null;
    }).filter((p): p is readonly [number, number] => p !== null && p[1] >= TOP && p[1] <= H - BOTTOM);
    return { moves, path };
  }).filter((curve) => curve.path.length > 1) : [];

  return (
    <svg className="rc-scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={view.label}>
      <ArrowMarker id={marker} />
      {corners ? (
        <g>
          <rect x={corners.x} y={corners.y} width={Math.max(0, W - RIGHT - corners.x)} height={Math.max(0, H - BOTTOM - corners.y)} className="rc-quadrant" />
          <line x1={corners.x} x2={corners.x} y1={TOP} y2={H - BOTTOM} className="rc-divider" />
          <line x1={LEFT} x2={W - RIGHT} y1={corners.y} y2={corners.y} className="rc-divider" />
          <text x={LEFT + 6} y={TOP + 22} className="rc-corner">THINK SLOW · TURN SLOW</text>
          <text x={W - RIGHT - 6} y={TOP + 22} textAnchor="end" className="rc-corner">THINK SLOW · TURN FAST</text>
          <text x={LEFT + 6} y={H - BOTTOM - 6} className="rc-corner">THINK FAST · TURN SLOW</text>
          <text x={W - RIGHT - 6} y={H - BOTTOM - 6} textAnchor="end" className="rc-corner">THINK FAST · TURN FAST</text>
        </g>
      ) : null}
      {niceTicks(x0, x1).map((value) => (
        <g key={`x${value}`}>
          <line x1={px(value)} x2={px(value)} y1={TOP} y2={H - BOTTOM} className="rc-grid" />
          <text x={px(value)} y={H - BOTTOM + 14} textAnchor="middle" className="rc-axis">{view.xTick(value)}</text>
        </g>
      ))}
      {niceTicks(y0, y1).map((value) => (
        <g key={`y${value}`}>
          <line x1={LEFT} x2={W - RIGHT} y1={py(value)} y2={py(value)} className="rc-grid" />
          <text x={LEFT - 6} y={py(value) + 3} textAnchor="end" className="rc-axis">{seconds(value)}</text>
        </g>
      ))}
      {moveCurves.map((curve) => (
        <g key={curve.moves}>
          <polyline points={curve.path.map((p) => p.join(",")).join(" ")} className="rc-curve" />
          <text x={curve.path[0][0] + 4} y={curve.path[0][1] + 10} className="rc-axis">{curve.moves} mv</text>
        </g>
      ))}
      <text x={(W + LEFT) / 2} y={H - 4} textAnchor="middle" className="rc-label">{view.xAxis}</text>
      <text x={12} y={(H - BOTTOM) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(H - BOTTOM) / 2})`} className="rc-label">{view.yAxis}</text>
      {plotted.map((p) => {
        const from = p.usual ? [px(p.usual.x), py(p.usual.y)] as [number, number] : null;
        const end = from ? arrowEnd(from, [p.cx, p.cy], p.r + 2) : null;
        return (
          <g key={p.step.name}>
            <title>{`${p.step.name}: ${describe(mode, p.step)}${p.usual ? ` · usual ${describeValues(mode, p.usual.x, p.usual.y)}` : ""}`}</title>
            {from ? <circle cx={from[0]} cy={from[1]} r={4} className="rc-usual" /> : null}
            {from && end ? <line x1={from[0]} y1={from[1]} x2={end[0]} y2={end[1]} className="rc-arrow" markerEnd={`url(#${marker})`} /> : null}
            <circle cx={p.cx} cy={p.cy} r={p.r} fill={stepColour(p.step.name)} className="rc-dot" />
            <text x={p.label.x} y={p.label.y} textAnchor={p.label.anchor} className="rc-label">{shortStep(p.step.name)}</text>
          </g>
        );
      })}
    </svg>
  );
}

type Box = { left: number; right: number; top: number; bottom: number };

/** Put each dot's label on whichever side of it is free, so neighbours stay readable. */
function placeLabels<T extends { cx: number; cy: number; r: number; step: SolveStep }>(points: T[]) {
  const taken: Box[] = points.map((p) => ({ left: p.cx - p.r, right: p.cx + p.r, top: p.cy - p.r, bottom: p.cy + p.r }));
  return points.map((p) => {
    const width = shortStep(p.step.name).length * 6.6 + 2;
    const options = [
      { x: p.cx + p.r + 4, y: p.cy - 5, anchor: "start" as const },
      { x: p.cx + p.r + 4, y: p.cy + 13, anchor: "start" as const },
      { x: p.cx - p.r - 4, y: p.cy - 5, anchor: "end" as const },
      { x: p.cx - p.r - 4, y: p.cy + 13, anchor: "end" as const },
      { x: p.cx, y: p.cy - p.r - 5, anchor: "middle" as const },
      { x: p.cx, y: p.cy + p.r + 13, anchor: "middle" as const },
    ];
    const boxOf = (o: (typeof options)[number]): Box => {
      const left = o.anchor === "start" ? o.x : o.anchor === "end" ? o.x - width : o.x - width / 2;
      return { left, right: left + width, top: o.y - 10, bottom: o.y + 2 };
    };
    const clear = (box: Box) => taken.every((other) =>
      box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom);
    const label = options.find((o) => clear(boxOf(o))) ?? options[0];
    taken.push(boxOf(label));
    return { ...p, label };
  });
}

function describeValues(mode: ResultScatter, x: number, y: number): string {
  if (mode === "recexec") return `recognition ${seconds(x)}, execution ${seconds(y)}`;
  if (mode === "speed") return `${x.toFixed(1)} TPS, execution ${seconds(y)}`;
  return `${x.toFixed(1)} TPS, recognition ${seconds(y)}`;
}

function describe(mode: ResultScatter, step: SolveStep): string {
  const view = MODES[mode];
  return `${describeValues(mode, view.x(step), view.y(step))} · ${step.sliceTurns} moves`;
}
