import { useId } from "react";
import type { TrainingGuideMove } from "../../cube/training";

type Point3 = readonly [number, number, number];
type Point2 = readonly [number, number];
const LATITUDE = 27 * Math.PI / 180;
const LONGITUDE = 32 * Math.PI / 180;
const CAMERA_DISTANCE = 6.25;
const HALF_CUBE_SIZE = 0.555;
const PROJECTION_SCALE = 200 * HALF_CUBE_SIZE / (CAMERA_DISTANCE * Math.tan(10 * Math.PI / 180));
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/** Perspective projection tuned to CubeView's fixed PG3D camera. */
function project([x, y, z]: Point3): Point2 {
  const depth = x * Math.sin(LONGITUDE) * Math.cos(LATITUDE) + y * Math.sin(LATITUDE) + z * Math.cos(LONGITUDE) * Math.cos(LATITUDE);
  const scale = PROJECTION_SCALE / (1 - depth * HALF_CUBE_SIZE / CAMERA_DISTANCE);
  return [200 + scale * (x * Math.cos(LONGITUDE) - z * Math.sin(LONGITUDE)),
    200 - scale * (-x * Math.sin(LATITUDE) * Math.sin(LONGITUDE) + y * Math.cos(LATITUDE) - z * Math.sin(LATITUDE) * Math.cos(LONGITUDE))];
}

function path(points: readonly Point2[], close = false): string {
  return points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ") + (close ? " Z" : "");
}

function layerFaces(move: TrainingGuideMove): Point2[][] {
  const bounds: [number, number][] = [[-1, 1], [-1, 1], [-1, 1]];
  bounds[AXIS_INDEX[move.axis]] = [...move.layers];
  // The three camera-facing surfaces of the affected prism.
  return [0, 1, 2].map((axis) => {
    const others = [0, 1, 2].filter((value) => value !== axis);
    return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => {
      const point: [number, number, number] = [0, 0, 0];
      point[axis] = bounds[axis][1];
      point[others[0]] = bounds[others[0]][a];
      point[others[1]] = bounds[others[1]][b];
      return project(point);
    });
  });
}

function ringPoint(move: TrainingGuideMove, angle: number): Point2 {
  const layer = (move.layers[0] + move.layers[1]) / 2;
  const radius = move.kind === "rotation" ? 1.85 : 1.57;
  const a = radius * Math.cos(angle);
  const b = radius * Math.sin(angle);
  return project(move.axis === "x" ? [layer, a, b] : move.axis === "y" ? [b, layer, a] : [a, b, layer]);
}

function arrowhead(tip: Point2, previous: Point2): string {
  const dx = tip[0] - previous[0], dy = tip[1] - previous[1];
  const length = Math.hypot(dx, dy);
  const ux = dx / length, uy = dy / length;
  return path([tip, [tip[0] - ux * 21 + uy * 11, tip[1] - uy * 21 - ux * 11],
    [tip[0] - ux * 15, tip[1] - uy * 15],
    [tip[0] - ux * 21 - uy * 11, tip[1] - uy * 21 + ux * 11]], true);
}

export function CubeMoveGuide({ move }: { move: TrainingGuideMove }) {
  const id = useId().replaceAll(":", "");
  // Half turns deliberately use a neutral direction and heads at both ends.
  const direction = move.halfTurn ? 1 : move.direction;
  const start = -Math.PI / 3;
  const points = Array.from({ length: 65 }, (_, index) => ringPoint(move, start + direction * index / 64 * Math.PI * 1.45));
  const label = `${move.token}: ${move.kind === "rotation" ? "whole cube" : move.kind === "wide" ? "two layers" : move.kind === "slice" ? "middle slice" : "outer layer"}${move.halfTurn ? ", 180 degrees" : ""}`;
  return (
    <svg className={`cube-move-guide ${move.kind}${move.halfTurn ? " half-turn" : ""}`} viewBox="0 0 400 400" role="img" aria-label={label}
      data-axis={move.axis} data-direction={move.halfTurn ? "either" : move.direction}>
      <defs>
        <linearGradient id={`${id}-ribbon`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-dim)" /><stop offset="0.5" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--text)" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="var(--bg)" floodOpacity="0.8" />
        </filter>
      </defs>
      <g className="cube-guide-layer">{layerFaces(move).map((face, index) => <path key={index} d={path(face, true)} />)}</g>
      <g filter={`url(#${id}-shadow)`}>
        <path className="cube-guide-arc-shadow" d={path(points)} />
        <path className="cube-guide-arc" stroke={`url(#${id}-ribbon)`} d={path(points)} />
        <path className="cube-guide-arrowhead" d={arrowhead(points[64], points[62])} />
        {move.halfTurn ? <path className="cube-guide-arrowhead" d={arrowhead(points[0], points[2])} /> : null}
      </g>
      <g className="cube-guide-label" transform="translate(200 355)">
        <rect x="-66" y="-19" width="132" height="38" rx="19" />
        <text textAnchor="middle" dominantBaseline="central">{move.token}{move.halfTurn ? " · 180°" : move.kind === "wide" ? " · 2 layers" : move.kind === "slice" ? " · slice" : move.kind === "rotation" ? " · cube" : ""}</text>
      </g>
    </svg>
  );
}
