import { FACE_COLOURS } from "../../cube/colours";
import type { LastLayerStickerPresentation, LastLayerThumbnailModel } from "../../cube/lastLayerThumbnail";

const CORE_SIZE = 10;
const RIM_THICKNESS = 6;
const PADDING = 1;
const GREY = "#52575d";

function stickers(presentations: readonly LastLayerStickerPresentation[], columns: number, width: number, height: number) {
  return presentations.map((presentation, index) => (
    <rect
      key={index}
      className="ll-sticker"
      x={(index % columns) * width}
      y={Math.floor(index / columns) * height}
      width={width}
      height={height}
      fill={presentation === "grey" ? GREY : FACE_COLOURS[presentation].hex}
    />
  ));
}

export function LastLayerCaseThumbnail({ model }: { model: LastLayerThumbnailModel }) {
  const coreStart = PADDING + RIM_THICKNESS;
  const coreEnd = coreStart + CORE_SIZE * 3;
  const diagramSize = coreEnd + RIM_THICKNESS + PADDING;
  return (
    <svg className="last-layer-thumbnail" viewBox={`0 0 ${diagramSize} ${diagramSize}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <g data-region="top" transform={`translate(${coreStart} ${coreStart})`}>{stickers(model.top, 3, CORE_SIZE, CORE_SIZE)}</g>
      <g data-region="back" transform={`translate(${coreStart} ${PADDING})`}>{stickers(model.back, 3, CORE_SIZE, RIM_THICKNESS)}</g>
      <g data-region="right" transform={`translate(${coreEnd} ${coreStart})`}>{stickers(model.right, 1, RIM_THICKNESS, CORE_SIZE)}</g>
      <g data-region="front" transform={`translate(${coreStart} ${coreEnd})`}>{stickers(model.front, 3, CORE_SIZE, RIM_THICKNESS)}</g>
      <g data-region="left" transform={`translate(${PADDING} ${coreStart})`}>{stickers(model.left, 1, RIM_THICKNESS, CORE_SIZE)}</g>
    </svg>
  );
}
