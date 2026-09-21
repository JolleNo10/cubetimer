import { faceColour } from "../cube/colours";
import type { Face } from "../cube/moves";

/**
 * Which way up the moves beside it are meant to be read.
 *
 * A sequence like `R U R'` says nothing on its own: which face is R depends entirely
 * on how the cube is being held. Anywhere this app prints moves that are not written
 * relative to the scramble, it has to say what it assumed.
 */
export function GripLabel({
  bottom,
  front,
  prefix,
}: {
  bottom: Face;
  front: Face;
  prefix?: string;
}) {
  return (
    <span className="grip-label">
      {prefix ? <span className="faint">{prefix} </span> : null}
      <span className="colour-dot" style={{ background: faceColour(bottom).hex }} />
      {faceColour(bottom).name} down
      <span className="faint"> · </span>
      <span className="colour-dot" style={{ background: faceColour(front).hex }} />
      {faceColour(front).name} front
    </span>
  );
}
