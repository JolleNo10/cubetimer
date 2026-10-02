import { FACE_COLOURS } from "../cube/colours";
import type { LastLayerStickerPresentation, LastLayerThumbnailModel } from "../cube/lastLayerThumbnail";

const CELL_SIZE = 10;
const GREY = "#52575d";

function stickers(presentations: readonly LastLayerStickerPresentation[], columns: number) {
  return presentations.map((presentation, index) => (
    <rect
      key={index}
      className="ll-sticker"
      x={(index % columns) * CELL_SIZE}
      y={Math.floor(index / columns) * CELL_SIZE}
      width={CELL_SIZE}
      height={CELL_SIZE}
      fill={presentation === "grey" ? GREY : FACE_COLOURS[presentation].hex}
    />
  ));
}

export function LastLayerCaseThumbnail({ model }: { model: LastLayerThumbnailModel }) {
  return (
    <svg className="last-layer-thumbnail" viewBox="0 0 52 52" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <g data-region="top" transform="translate(11 11)">{stickers(model.top, 3)}</g>
      <g data-region="back" transform="translate(11 1)">{stickers(model.back, 3)}</g>
      <g data-region="right" transform="translate(41 11)">{stickers(model.right, 1)}</g>
      <g data-region="front" transform="translate(11 41)">{stickers(model.front, 3)}</g>
      <g data-region="left" transform="translate(1 11)">{stickers(model.left, 1)}</g>
    </svg>
  );
}
