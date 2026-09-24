/**
 * Just enough quaternion maths to read the cube's orientation off its gyroscope.
 *
 * Nothing here turns anything on screen. The drawn cube is placed by the grip the
 * tracker settles on, not by the raw pose, so what these are for is comparing one
 * orientation against another.
 */
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


