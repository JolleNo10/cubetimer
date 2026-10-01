import type { JSX } from "react";
import { FACE_COLOURS } from "../cube/colours";
import { FACE_OFFSET, type Face } from "../cube/moves";
import type { F2lThumbnailModel } from "../cube/f2lThumbnail";

type Point = { x: number; y: number };
type Vector = Point;
export type F2lThumbnailView = "basic" | "advanced";

const MUTED_STICKER = "#52575d";
const STICKER_STROKE = "#171a1f";

function add(point: Point, vector: Vector): Point {
  return { x: point.x + vector.x, y: point.y + vector.y };
}

function polygonPoints(points: readonly Point[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function stickerPresentation(
  model: F2lThumbnailModel,
  faceletsIndex: number,
  view: F2lThumbnailView,
) {
  const emphasized = model.emphasized[faceletsIndex];
  const colour = FACE_COLOURS[model.facelets[faceletsIndex] as Face]?.hex ?? MUTED_STICKER;
  return {
    fill: emphasized || view === "advanced" ? colour : MUTED_STICKER,
    // Preserve surrounding Advanced state without competing with the target pair.
    fillOpacity: view === "advanced" ? (emphasized ? 1 : 0.45) : undefined,
  };
}

function renderFace(
  model: F2lThumbnailModel,
  face: Face,
  origin: Point,
  across: Vector,
  down: Vector,
  view: F2lThumbnailView,
): JSX.Element[] {
  const offset = FACE_OFFSET[face];
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const start = add(add(origin, { x: across.x * column, y: across.y * column }), {
      x: down.x * row,
      y: down.y * row,
    });
    const nextAcross = add(start, across);
    const nextDown = add(start, down);
    return (
      <polygon
        key={`${face}-${index}`}
        className="f2l-thumbnail-sticker"
        data-facelet={offset + index}
        points={polygonPoints([start, nextAcross, add(nextAcross, down), nextDown])}
        {...stickerPresentation(model, offset + index, view)}
        stroke={STICKER_STROKE}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    );
  });
}

export function F2lCaseThumbnail({ model, view = "basic" }: {
  model: F2lThumbnailModel;
  view?: F2lThumbnailView;
}) {
  return (
    <svg
      className="f2l-case-thumbnail"
      viewBox="0 0 132 104"
      aria-hidden="true"
      focusable="false"
    >
      {renderFace(model, "U", { x: 66, y: 12 }, { x: 12, y: 6 }, { x: -12, y: 6 }, view)}
      {renderFace(model, "F", { x: 30, y: 30 }, { x: 12, y: 6 }, { x: 0, y: 14 }, view)}
      {renderFace(model, "R", { x: 66, y: 48 }, { x: 12, y: -6 }, { x: 0, y: 14 }, view)}
    </svg>
  );
}
