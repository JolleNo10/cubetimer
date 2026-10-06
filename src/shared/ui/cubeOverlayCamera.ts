/** Shared camera maths for flat SVG overlays laid over the PG3D replay/training cube. */

export type Point3 = readonly [number, number, number];
export type Point2 = readonly [number, number];
/** Orbit camera angles in degrees, as cubing.js reports them. */
export type GuideCamera = { latitude: number; longitude: number };
export const DEFAULT_GUIDE_CAMERA: GuideCamera = { latitude: 27, longitude: 32 };
export type Camera = { sinLat: number; cosLat: number; sinLon: number; cosLon: number };
const CAMERA_DISTANCE = 6.25;
const HALF_CUBE_SIZE = 0.555;
const PROJECTION_SCALE = 200 * HALF_CUBE_SIZE / (CAMERA_DISTANCE * Math.tan(10 * Math.PI / 180));

export function toCamera({ latitude, longitude }: GuideCamera): Camera {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  return { sinLat: Math.sin(lat), cosLat: Math.cos(lat), sinLon: Math.sin(lon), cosLon: Math.cos(lon) };
}

/** Unit vector from the cube centre towards the camera. */
export function cameraDirection(c: Camera): Point3 {
  return [c.sinLon * c.cosLat, c.sinLat, c.cosLon * c.cosLat];
}

export function cameraDepth(c: Camera, [x, y, z]: Point3): number {
  const [dx, dy, dz] = cameraDirection(c);
  return x * dx + y * dy + z * dz;
}

/** Perspective projection tuned to the PG3D orbit camera. */
export function project(c: Camera, [x, y, z]: Point3): Point2 {
  const depth = cameraDepth(c, [x, y, z]);
  const scale = PROJECTION_SCALE / (1 - depth * HALF_CUBE_SIZE / CAMERA_DISTANCE);
  return [200 + scale * (x * c.cosLon - z * c.sinLon),
    200 - scale * (-x * c.sinLat * c.sinLon + y * c.cosLat - z * c.sinLat * c.cosLon)];
}
