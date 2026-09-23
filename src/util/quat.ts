/** Just enough quaternion maths to orient the 3D cube from the gyroscope. */
export type Quat = { x: number; y: number; z: number; w: number };

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function normalize(q: Quat): Quat {
  const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/** Intrinsic XYZ Euler angles, in radians. */
export function fromEuler(x: number, y: number, z: number): Quat {
  const [cx, cy, cz] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
  const [sx, sy, sz] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

/**
 * The rotation that takes `from` to `to`, expressed in `from`'s own coordinates.
 *
 * Both arguments map the cube's body frame onto the world, so conjugating one by the
 * other cancels the world out: whatever frame the gyroscope thinks it is measuring
 * against, and however far that frame has drifted, falls away. Every question about
 * how the cube has turned since some reference pose is asked through this.
 */
export function relative(from: Quat, to: Quat): Quat {
  return multiply(conjugate(from), to);
}

/**
 * The quaternion as a 3x3 rotation matrix, in row-major order.
 *
 * Columns are where the body's own axes end up, which is what makes a matrix easier to
 * reason about than the quaternion here: comparing two orientations becomes a dot
 * product over nine numbers.
 */
export function toMatrix(q: Quat): number[] {
  const { x, y, z, w } = normalize(q);
  const [xx, yy, zz] = [x * x, y * y, z * z];
  const [xy, xz, yz] = [x * y, x * z, y * z];
  const [wx, wy, wz] = [w * x, w * y, w * z];
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let end = b;
  if (cos < 0) {
    cos = -cos;
    end = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cos > 0.9995) {
    return normalize({
      x: a.x + (end.x - a.x) * t,
      y: a.y + (end.y - a.y) * t,
      z: a.z + (end.z - a.z) * t,
      w: a.w + (end.w - a.w) * t,
    });
  }
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sin;
  const wb = Math.sin(t * angle) / sin;
  return {
    x: a.x * wa + end.x * wb,
    y: a.y * wa + end.y * wb,
    z: a.z * wa + end.z * wb,
    w: a.w * wa + end.w * wb,
  };
}

/**
 * The cube reports orientation in a right-handed frame with +X through the red face,
 * +Y through blue and +Z through white; three.js wants Y up and Z toward the viewer.
 */
export function cubeToSceneQuaternion(q: Quat): Quat {
  return normalize({ x: -q.x, y: q.z, z: -q.y, w: q.w });
}
