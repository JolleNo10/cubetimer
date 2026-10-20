/**
 * Following the cube's orientation through a solve, live.
 *
 * The gyroscope has no idea which way is up. It reports a pose in a frame of its own
 * choosing that drifts as the solve goes on, so a reading only means something next to
 * another reading. Scramble completion supplies the known white-up, green-front
 * solve pose. The latest raw sighting is retained separately from the stable published
 * reference: continuous presentation needs that baseline even while scrambling.
 * Scramble completion adopts the last sighting as the solve reference, removing the
 * drift built up beforehand. Explicit Reset gyro instead establishes and locks the
 * current pose immediately.
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
   * Keep the latest scramble sighting without moving the published reference. The
   * first valid sample supplies an initial baseline. Only locked readings produce
   * snapped and settled grip for presentation and solve reconstruction.
   */
  sample(q: Quat, t: number): void {
    if (![q.x, q.y, q.z, q.w].every(Number.isFinite) || Math.hypot(q.x, q.y, q.z, q.w) === 0) return;
    this.#latest = { ...q };
    this.#latestAt = t;
    this.#reference ??= this.#latest;
    if (!this.#locked) return;
    const reference = this.#reference ?? q;
    this.#snapped = this.#bottom
      ? snapWithBottom(q, reference, this.#bottom)
      : snapOrientation(q, reference);
    this.#settle(this.#snapped.orientation, t);
  }

  /**
   * The scramble is finished: whatever pose the cube is in now is white on top and
   * green in front, and everything from here is measured against it. Returns whether
   * the published reference changed; an explicit locked reset is left intact.
   */
  lockReference(): boolean {
    if (this.#locked) return false;
    const before = this.#reference;
    this.#reference = this.#latest ?? before;
    this.#locked = true;
    if (this.#latest) this.sample(this.#latest, this.#latestAt);
    const after = this.#reference;
    return after !== null && (before === null ||
      after.x !== before.x || after.y !== before.y || after.z !== before.z || after.w !== before.w);
  }

  /** Clear solve grip for a new scramble, retaining the stable live baseline. */
  reset(): void {
    this.#locked = false;
    this.#snapped = null;
    this.#steady = null;
    this.#candidate = null;
    this.#bottom = null;
    // Raw motion stays relative to this baseline until the latest scramble sighting
    // is adopted at lockReference(), or the user explicitly rebases.
  }

  /** Explicit calibration, independent of the automatic scramble lifecycle. */
  rebaseToCurrentPose(): boolean {
    if (!this.#latest) return false;
    this.reset();
    this.#reference = { ...this.#latest };
    this.#locked = true;
    this.sample(this.#latest, this.#latestAt);
    return true;
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
