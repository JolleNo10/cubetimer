/**
 * Following the cube's orientation through a solve, live.
 *
 * The gyroscope has no idea which way is up. It reports a pose in a frame of its own
 * choosing that drifts as the solve goes on, so a reading only means something next to
 * another reading. What gives it meaning here is the scramble: scrambles are applied
 * white on top and green in front, and the cube is not turned over while they are being
 * applied, so every reading taken during the scramble is a fresh sighting of that one
 * known pose. Keeping the last of them as the reference throws away all the drift that
 * built up beforehand, and leaves the solve measured against the grip it started from.
 *
 * Samples are kept from the moment the scramble finishes, because the turn of the cube
 * during inspection is part of what has to be reconstructed.
 */
import { snapOrientation, type Snapped } from "./gyroGrip";
import type { Orientation } from "./orientation";
import type { Quat } from "../util/quat";

export type GyroSample = { q: Quat; t: number };

/** Two readings this close together and this alike say nothing new. */
const MIN_SAMPLE_GAP_MS = 20;
const SAME_POSE_DOT = 0.9999;
/** A very slow solve at full reporting rate is a few thousand; this is only a backstop. */
const MAX_SAMPLES = 20_000;

function alike(a: Quat, b: Quat): boolean {
  return Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) > SAME_POSE_DOT;
}

export class LiveGrip {
  #reference: Quat | null = null;
  #locked = false;
  #samples: GyroSample[] = [];
  #latest: Quat | null = null;
  #latestAt = 0;
  #keptAt = Number.NEGATIVE_INFINITY;
  #snapped: Snapped | null = null;

  /**
   * Take a reading.
   *
   * Until the reference is locked this is a sighting of the scrambling pose and simply
   * replaces it. Afterwards it is a measurement of how far the cube has been turned
   * since, and is kept for the reconstruction.
   */
  sample(q: Quat, t: number): void {
    this.#latest = q;
    this.#latestAt = t;
    if (!this.#locked) {
      this.#reference = q;
      return;
    }
    this.#snapped = snapOrientation(q, this.#reference ?? q);
    const previous = this.#samples[this.#samples.length - 1];
    if (
      previous &&
      t - this.#keptAt < MIN_SAMPLE_GAP_MS &&
      alike(previous.q, q)
    ) {
      return;
    }
    if (this.#samples.length >= MAX_SAMPLES) return;
    this.#samples.push({ q, t });
    this.#keptAt = t;
  }

  /**
   * The scramble is finished: whatever pose the cube is in now is white on top and
   * green in front, and everything from here is measured against it.
   */
  lockReference(): void {
    if (this.#locked) return;
    this.#locked = true;
    this.#samples = [];
    this.#keptAt = Number.NEGATIVE_INFINITY;
    if (this.#latest) this.sample(this.#latest, this.#latestAt);
  }

  /** Forget everything: a new scramble is being applied. */
  reset(): void {
    this.#locked = false;
    this.#samples = [];
    this.#snapped = null;
    this.#keptAt = Number.NEGATIVE_INFINITY;
    // The reference is deliberately kept. It is still the best guess at the scrambling
    // pose, so the live view has something to work from before the next reading lands.
  }

  get locked(): boolean {
    return this.#locked;
  }

  get reference(): Quat | null {
    return this.#reference;
  }

  /** Whether the cube has ever reported its orientation. */
  get active(): boolean {
    return this.#latest !== null;
  }

  /**
   * The latest raw reading, once there is a reference to measure it against.
   *
   * Raw rather than snapped: a reading taken as a move lands is often caught between
   * two grips, and which one it settles on is a question for the whole solve to
   * answer, not for this one reading.
   */
  get pose(): Quat | null {
    return this.#locked ? this.#latest : null;
  }

  /** The best current reading, or null before the reference is locked. */
  get snapped(): Snapped | null {
    return this.#snapped;
  }

  get orientation(): Orientation | null {
    return this.#snapped?.orientation ?? null;
  }

  get samples(): readonly GyroSample[] {
    return this.#samples;
  }

  /** The reading nearest a moment, for lining the track up with the move stream. */
  at(t: number): Snapped | null {
    const sample = this.sampleAt(t);
    if (!sample || !this.#reference) return null;
    return snapOrientation(sample.q, this.#reference);
  }

  /** The raw reading nearest a moment. */
  sampleAt(t: number): GyroSample | null {
    if (this.#samples.length === 0) return null;
    let lo = 0;
    let hi = this.#samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#samples[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const after = this.#samples[lo];
    const before = this.#samples[lo - 1];
    if (!before) return after;
    return t - before.t <= after.t - t ? before : after;
  }
}
