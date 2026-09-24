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
 * Only the latest reading is kept. What the reconstruction works from is the pose as
 * each move landed, which the controller takes a copy of move by move; a running log
 * of everything the cube said in between would be so much bookkeeping for a question
 * nothing asks.
 */
import { snapOrientation, snapWithBottom, type Snapped } from "./gyroGrip";
import type { Orientation } from "./orientation";
import type { Face } from "./moves";
import type { Quat } from "../util/quat";

/**
 * How long a new grip has to hold before it counts as the grip.
 *
 * Roughly how long turning the cube takes. Anything that comes and goes faster than
 * this is a hand moving over the cube, not the cube moving in the hand, and following
 * it would only make the view flicker.
 */
const STEADY_MS = 120;

export class LiveGrip {
  #reference: Quat | null = null;
  #locked = false;
  #latest: Quat | null = null;
  #latestAt = 0;
  #snapped: Snapped | null = null;
  #steady: Orientation | null = null;
  #candidate: Orientation | null = null;
  #candidateSince = 0;
  #bottom: Face | null = null;

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
    const reference = this.#reference ?? q;
    this.#snapped = this.#bottom
      ? snapWithBottom(q, reference, this.#bottom)
      : snapOrientation(q, reference);
    this.#settle(this.#snapped.orientation, t);
  }

  /**
   * The scramble is finished: whatever pose the cube is in now is white on top and
   * green in front, and everything from here is measured against it.
   */
  lockReference(): void {
    if (this.#locked) return;
    this.#locked = true;
    if (this.#latest) this.sample(this.#latest, this.#latestAt);
  }

  /** Forget everything: a new scramble is being applied. */
  reset(): void {
    this.#locked = false;
    this.#snapped = null;
    this.#steady = null;
    this.#candidate = null;
    this.#bottom = null;
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

  /**
   * The grip once it has stopped changing its mind.
   *
   * `orientation` is the latest reading and jumps about as hands move over the cube.
   * Anything a person looks at wants this one instead.
   */
  get steady(): Orientation | null {
    return this.#steady;
  }

  /**
   * Hold one face underneath until told otherwise.
   *
   * Through a solve the cross face stays down — the solver turns the cube about the
   * vertical axis and no other way — so once the solve is under way the only real
   * question is which side is facing them. Asking that narrower question keeps a
   * drifting reading from tipping the cube over on screen, which is the one kind of
   * mistake that makes the view useless rather than merely wrong.
   *
   * `null` to go back to considering every way of holding it.
   */
  holdBottom(face: Face | null): void {
    if (face === this.#bottom) return;
    this.#bottom = face;
    // The constraint changes what the last reading meant, so do not let a grip
    // settled under the old one linger.
    this.#candidate = null;
    if (this.#locked && this.#latest) this.sample(this.#latest, this.#latestAt);
  }

  /** The face being held underneath, if any. */
  get heldBottom(): Face | null {
    return this.#bottom;
  }

  /** Adopt a new grip once it has been the answer for long enough to believe. */
  #settle(candidate: Orientation, t: number): void {
    if (candidate !== this.#candidate) {
      this.#candidate = candidate;
      this.#candidateSince = t;
    }
    // The first reading has nothing to flicker against, so it is taken as read.
    if (this.#steady === null || t - this.#candidateSince >= STEADY_MS) {
      this.#steady = candidate;
    }
  }



}
