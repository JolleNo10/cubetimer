import { cameraDirection, project, toCamera, type GuideCamera } from "./cubeOverlayCamera";

/** How far out from the cube centre the marker floats; the Front face sits at 1. */
const MARKER_DISTANCE = 1.6;
/** Cube units per local SVG unit, so the letter is drawn at a readable font size. */
const UNIT = 0.01;

/**
 * A ghost "F" floating in front of the Front face, laid in that face's plane so it
 * turns with the camera. The affine fit is close enough to the perspective at this size.
 */
export function CubeFrontMarker({ camera, visible }: { camera: GuideCamera; visible: boolean }) {
  const c = toCamera(camera);
  const [ox, oy] = project(c, [0, 0, MARKER_DISTANCE]);
  const [rx, ry] = project(c, [UNIT, 0, MARKER_DISTANCE]);
  const [ux, uy] = project(c, [0, UNIT, MARKER_DISTANCE]);
  // Local +x runs along the cube's +x, local +y (down in SVG) along the cube's -y.
  const matrix = [rx - ox, ry - oy, ox - ux, oy - uy, ox, oy].map((value) => value.toFixed(4)).join(" ");
  // Fainter, not hidden, when Front is turned away: it still says where Front went.
  const opacity = Math.max(0.45, cameraDirection(c)[2]);
  return (
    <svg className={`cube-front-marker${visible ? " visible" : ""}`} viewBox="0 0 400 400" aria-hidden="true">
      <g transform={`matrix(${matrix})`} opacity={opacity.toFixed(3)}>
        <text textAnchor="middle" dominantBaseline="central">F</text>
      </g>
    </svg>
  );
}
