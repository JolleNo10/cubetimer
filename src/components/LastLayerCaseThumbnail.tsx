import type { JSX } from "react";
import { FACE_COLOURS } from "../cube/colours";
import type { Face } from "../cube/moves";
import type { LastLayerThumbnailModel } from "../cube/lastLayerThumbnail";

const MUTED = "var(--panel-2)";
const STROKE = "var(--border-strong)";
const FACES = ["F", "R", "B", "L"] as const;
const OFFSETS = { U: 0, R: 9, F: 18, L: 36, B: 45 } as const;

function sticker(model: LastLayerThumbnailModel, index: number, x: number, y: number, size: number): JSX.Element {
  const face = model.facelets[index] as Face;
  const colour = FACE_COLOURS[face]?.hex ?? MUTED;
  const visible = model.visible.includes(index);
  return <rect key={index} x={x} y={y} width={size} height={size} fill={visible ? colour : MUTED} stroke={STROKE} strokeWidth="0.7" rx="1" />;
}

export function LastLayerCaseThumbnail({ model }: { model: LastLayerThumbnailModel }) {
  const size = 10;
  const u = Array.from({ length: 9 }, (_, index) => sticker(model, index, 42 + (index % 3) * size, 4 + Math.floor(index / 3) * size, size));
  const strips = FACES.flatMap((face, faceIndex) => [0, 1, 2].map((rowIndex) => {
    const x = 8 + faceIndex * 31 + rowIndex * size;
    const y = 50;
    return sticker(model, OFFSETS[face] + rowIndex, x, y, size);
  }));
  return (
    <svg className="last-layer-thumbnail" viewBox="0 0 140 72" aria-hidden="true" focusable="false">
      {u}
      {strips}
      <path d="M8 49 H132" stroke={STROKE} strokeWidth="1" />
    </svg>
  );
}
