import { useId } from "react";
import type { MoveGuide } from "../../cube/moveGuide";

type Point3 = readonly [number, number, number];
type Point2 = readonly [number, number];
const LATITUDE = 27 * Math.PI / 180;
const LONGITUDE = 32 * Math.PI / 180;
const CAMERA_DISTANCE = 6.25;
const HALF_CUBE_SIZE = 0.555;
const PROJECTION_SCALE = 200 * HALF_CUBE_SIZE / (CAMERA_DISTANCE * Math.tan(10 * Math.PI / 180));
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

function cameraDepth([x, y, z]: Point3): number {
  return x * Math.sin(LONGITUDE) * Math.cos(LATITUDE) + y * Math.sin(LATITUDE) + z * Math.cos(LONGITUDE) * Math.cos(LATITUDE);
}

/** Perspective projection tuned to CubeView's fixed PG3D camera. */
function project([x, y, z]: Point3): Point2 {
  const depth = cameraDepth([x, y, z]);
  const scale = PROJECTION_SCALE / (1 - depth * HALF_CUBE_SIZE / CAMERA_DISTANCE);
  return [200 + scale * (x * Math.cos(LONGITUDE) - z * Math.sin(LONGITUDE)),
    200 - scale * (-x * Math.sin(LATITUDE) * Math.sin(LONGITUDE) + y * Math.cos(LATITUDE) - z * Math.sin(LATITUDE) * Math.cos(LONGITUDE))];
}

function path(points: readonly Point2[], close = false): string {
  return points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ") + (close ? " Z" : "");
}

function surfaceBands(move: MoveGuide) {
  const bounds: [number, number][] = [[-1, 1], [-1, 1], [-1, 1]];
  bounds[AXIS_INDEX[move.axis]] = [...move.layers];
  // Highlight only exterior cubie surfaces, never a slice's internal cut plane.
  return (["x", "y", "z"] as const).flatMap((surface) => {
    const axis = AXIS_INDEX[surface];
    if (surface === move.axis && move.layers[1] !== 1) return [];
    const others = [0, 1, 2].filter((value) => value !== axis);
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => {
      const point: [number, number, number] = [0, 0, 0];
      point[axis] = 1;
      point[others[0]] = bounds[others[0]][a];
      point[others[1]] = bounds[others[1]][b];
      return project(point);
    });
    return [{ surface, points }];
  });
}

function ringPoint(move: MoveGuide, angle: number): Point3 {
  const layer = (move.layers[0] + move.layers[1]) / 2;
  const radius = move.kind === "rotation" ? 1.55 : 1.3;
  const a = radius * Math.cos(angle);
  const b = radius * Math.sin(angle);
  return move.axis === "x" ? [layer, a, b] : move.axis === "y" ? [b, layer, a] : [a, b, layer];
}

function nearSideAngle(move: MoveGuide): number {
  let nearest = 0;
  for (let index = 1; index < 72; index++) {
    const angle = index / 72 * Math.PI * 2;
    if (cameraDepth(ringPoint(move, angle)) > cameraDepth(ringPoint(move, nearest))) nearest = angle;
  }
  return nearest;
}

function arrowhead(tip: Point2, previous: Point2): string {
  const dx = tip[0] - previous[0], dy = tip[1] - previous[1];
  const length = Math.hypot(dx, dy);
  const ux = dx / length, uy = dy / length;
  return path([tip, [tip[0] - ux * 14 + uy * 6.5, tip[1] - uy * 14 - ux * 6.5],
    [tip[0] - ux * 10, tip[1] - uy * 10],
    [tip[0] - ux * 14 - uy * 6.5, tip[1] - uy * 14 + ux * 6.5]], true);
}

export function CubeMoveGuide({ move }: { move: MoveGuide }) {
  const id = useId().replaceAll(":", "");
  // Half turns deliberately use a neutral direction and heads at both ends.
  const direction = move.halfTurn ? 1 : move.direction;
  const sweep = move.halfTurn ? Math.PI : Math.PI * 0.75;
  const start = nearSideAngle(move) - direction * sweep / 2;
  const points = Array.from({ length: 65 }, (_, index) => project(ringPoint(move, start + direction * index / 64 * sweep)));
  const label = `${move.token}: ${move.kind === "rotation" ? "whole cube" : move.kind === "wide" ? "two layers" : move.kind === "slice" ? "middle slice" : "outer layer"}${move.halfTurn ? ", 180 degrees" : ""}`;
  return (
    <svg className={`cube-move-guide ${move.kind}${move.halfTurn ? " half-turn" : ""}`} viewBox="0 0 400 400" role="img" aria-label={label}
      data-axis={move.axis} data-direction={move.halfTurn ? "either" : move.direction}>
      <defs>
        <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.3" floodColor="var(--bg)" floodOpacity="0.35" />
        </filter>
      </defs>
      <g className="cube-guide-layer">{surfaceBands(move).map(({ surface, points }) =>
        <path key={surface} data-surface={surface} data-normal="1" data-layer-min={move.layers[0]} data-layer-max={move.layers[1]} d={path(points, true)} />)}</g>
      <g filter={`url(#${id}-shadow)`}>
        <path className="cube-guide-arc-shadow" d={path(points)} />
        <path className="cube-guide-arc" d={path(points)} />
        <path className="cube-guide-arrowhead" d={arrowhead(points[64], points[62])} />
        {move.halfTurn ? <path className="cube-guide-arrowhead" d={arrowhead(points[0], points[2])} /> : null}
      </g>
      <g className="cube-guide-label" transform="translate(200 355)">
        <rect x="-57" y="-15" width="114" height="30" rx="15" />
        <text textAnchor="middle" dominantBaseline="central">{move.token}{move.halfTurn ? " · 180°" : move.kind === "wide" ? " · 2 layers" : move.kind === "slice" ? " · slice" : move.kind === "rotation" ? " · cube" : ""}</text>
      </g>
    </svg>
  );
}
