import type { KPattern } from "cubing/kpuzzle";
import type { GanCubeMove } from "gan-web-bluetooth";
import { SmartCube, type CubeHardware, type CubeStatus, type MacPrompt, type Quaternion } from "../infrastructure/bluetooth/smartCube";
import { faceColour } from "../cube/colours";
import { RECENTRE_GESTURE_TURNS, isRecentreGesture } from "../cube/gestures";
import { facesAtPositions } from "../cube/gyroGrip";
import { LiveGrip } from "../cube/liveGrip";
import { CubeModel } from "../cube/model";
import { parseFaceMove, type Face } from "../cube/moves";
import { reorientMove, type Orientation } from "../cube/orientation";
import { debugEnabled, debugLog } from "../util/debug";
import { Store } from "../shared/store";
import type { TimerPhase } from "../features/timer/TimerRuntime";

export type GyroReferenceChangeReason = "reset" | "scramble-lock";

export type CubeState = { cubeStatus: CubeStatus; virtualCube: boolean; hardware: CubeHardware | null; battery: number | null; cubeFacelets: string };
export type PhysicalCubeDependencies = {
  getTimerPhase: () => TimerPhase;
  getTimerElapsed: (now: number) => number | null;
  canReplacePattern: () => boolean;
  reportError: (error: string | null) => void;
  onMove: (move: GanCubeMove & { serial: number }, before: KPattern) => void;
  onPatternChanged: (reset: boolean) => void;
};
const GRIP_HEARTBEAT_MS = 2_000;

/** Owns the single physical model, transport facts and held-grip observations. */
export class PhysicalCubeRuntime {
  readonly state = new Store<CubeState>({ cubeStatus: "disconnected", virtualCube: false, hardware: null, battery: null, cubeFacelets: "" });
  readonly cube = new SmartCube();
  #model: CubeModel | null;
  #grip = new LiveGrip();
  #tracedGrip = "";
  #gripListeners = new Set<(orientation: Orientation) => void>();
  #gyroReadings = 0;
  #gyroListeners = new Set<(q: Quaternion) => void>();
  #gripHeartbeatAt = 0;
  #referenceListeners = new Set<(reason: GyroReferenceChangeReason) => void>();
  #recentTurns: string[] = [];
  #connectionRevision = 0;
  #moveListeners = new Set<(move: string) => void>();
  #patternListeners = new Set<(pattern: KPattern) => void>();
  constructor(dependencies: PhysicalCubeDependencies, model: CubeModel | null = null) {
    this.#model = model;
    if (model) this.state.update(state => ({ ...state, cubeFacelets: model.facelets }));
    this.#dependencies = dependencies;
    this.cube.setHandlers({
      onMove: (move) => this.handleMove(move),
      onFacelets: (facelets) => this.receiveFacelets(facelets),
      onGyro: (q) => {
        if (![q.x, q.y, q.z, q.w].every(Number.isFinite) || Math.hypot(q.x, q.y, q.z, q.w) === 0) return;
        if (this.#gyroReadings === 0) {
          debugLog("grip", "first gyro reading — following the cube");
        }
        this.#gyroReadings++;
        const before = this.#grip.steady;
        this.#grip.sample(q, performance.now());
        const after = this.#grip.steady;
        if (after && after !== before) {
          for (const listener of this.#gripListeners) listener(after);
        }
        for (const listener of this.#gyroListeners) listener(q);
        this.#traceGrip();
      },
      onBattery: (battery) => this.state.update((s) => ({ ...s, battery })),
      onHardware: (hardware) => {
        debugLog(
          "grip",
          hardware.gyroSupported === false
            ? `${hardware.hardwareName ?? "cube"} reports no gyroscope — there is nothing to track`
            : `${hardware.hardwareName ?? "cube"} connected, gyroscope supported`,
        );
        this.state.update((s) => ({ ...s, hardware }));
      },
      onStatus: (cubeStatus, error) => {
        this.#connectionRevision++;
        if (cubeStatus !== "connected") {
          this.#grip = new LiveGrip();
          this.#gyroReadings = 0;
          this.#recentTurns = [];
        }
        this.state.update(state => ({
          ...state, cubeStatus,
          hardware: cubeStatus === "connected" ? state.hardware : null,
          battery: cubeStatus === "connected" ? state.battery : null
        }));
        if (error) this.#dependencies.reportError(error);
        else if (cubeStatus === "connected") this.#dependencies.reportError(null);
      },
    });
  }
  readonly #dependencies: PhysicalCubeDependencies;
  get model(): CubeModel | null { return this.#model; }
  setModel(model: CubeModel): void { this.#model = model; this.#publishPattern(true); }
  get pose(): Quaternion | null { return this.#grip.pose; }
  get gripLocked(): boolean { return this.#grip.locked; }
  resetGrip(): void { this.#grip.reset(); this.#tracedGrip = ""; }
  holdBottom(bottom: Face | null): void { this.#grip.holdBottom(bottom); }
  observeTimerMove(move: string, phase: TimerPhase): void { this.#checkRecentreGesture(move, phase); this.#traceMove(move, phase); }
  handleMove(move: GanCubeMove & { serial: number }): void {
    if (!this.#model) return;
    const before = this.#model.pattern;
    this.#model.applyMove(move.move);
    for (const listener of this.#moveListeners) listener(move.move);
    this.#dependencies.onMove(move, before);
    this.#publishPattern(false);
  }
  get gripReference(): Quaternion | null {
    return this.#grip.reference;
  }

  /** How the cube is being held right now, or null before the scramble is finished. */
  get grip(): { bottom: Face; front: Face } | null {
    const orientation = this.#grip.orientation;
    if (!orientation) return null;
    const at = facesAtPositions(orientation);
    return { bottom: at.D, front: at.F };
  }

  /**
   * Take the cube's current pose as the reference.
   *
   * Normally this happens on its own when the scramble is finished. The solver can also
   * ask for it, which is what the recentre gesture and the button under the 3D view do.
   *
   * Inspection and solving keep one coherent reference for their recorded readings.
   * Only connected gyro hardware with a valid sample can establish a new reference.
   */
  resetGyro(): boolean {
    const phase = this.#dependencies.getTimerPhase();
    const state = this.state.get();
    if (phase === "inspection" || phase === "solving" ||
        state.cubeStatus !== "connected" || !state.hardware?.gyroSupported ||
        !this.#grip.rebaseToCurrentPose()) return false;
    this.#tracedGrip = "";
    for (const listener of this.#referenceListeners) listener("reset");
    return true;
  }

  onGyro(listener: (q: Quaternion) => void): () => void {
    this.#gyroListeners.add(listener);
    return () => { this.#gyroListeners.delete(listener); };
  }

  /**
   * Write one line per move: what the cube reported, how it was being held, and what
   * that turn therefore was from the solver's side.
   *
   * This is the whole point of the trace. A grip estimate is only ever wrong in terms
   * of the moves it mislabels, so the two have to be read together.
   */
  #traceMove(move: string, phase: TimerPhase): void {
    if (!debugEnabled("grip")) return;
    const orientation = this.#grip.orientation;
    const snapped = this.#grip.snapped;
    const grip = this.grip;
    // The first turn of a solve arrives before the clock is started, so there is no
    // elapsed time to quote for it yet.
    const when =
      phase === "solving"
        ? `+${Math.round(this.#dependencies.getTimerElapsed(performance.now()) ?? 0)}ms`.padStart(9)
        : phase.padStart(9);
    if (!orientation || !snapped || !grip) {
      // Still worth a line. A move with no grip beside it is the clearest possible
      // sign that the tracking has not started, and why.
      debugLog("grip", when, move.padEnd(3), this.#whyNoGrip());
      return;
    }
    debugLog(
      "grip",
      when,
      move.padEnd(3),
      `front=${faceColour(grip.front).name}`.padEnd(16),
      `m=${snapped.margin.toFixed(2)}`,
      "→",
      reorientMove(move, orientation),
    );
  }

  /** Why there is no reading to report, in the words of whatever is missing. */
  #whyNoGrip(): string {
    if (this.#gyroReadings === 0) {
      return this.hasCube
        ? "no gyro readings from the cube yet"
        : "no cube connected";
    }
    if (!this.#grip.locked) return "waiting for the scramble to be finished";
    return "no reading since the scramble finished";
  }

  /**
   * Say where the tracking has got to, every so often.
   *
   * The trace otherwise only speaks when something changes, and a solver holding the
   * cube still cannot tell that apart from the tracking being broken.
   */
  #traceHeartbeat(): void {
    if (!this.#grip.locked) return;
    const now = performance.now();
    if (now - this.#gripHeartbeatAt < GRIP_HEARTBEAT_MS) return;
    this.#gripHeartbeatAt = now;
    const grip = this.grip;
    const snapped = this.#grip.snapped;
    debugLog(
      "grip",
      `${this.#gyroReadings} readings ·`,
      grip && snapped
        ? `${faceColour(grip.front).name} front, ${faceColour(grip.bottom).name} down (${snapped.tokens.join(" ") || "as scrambled"}, m=${snapped.margin.toFixed(2)})`
        : this.#whyNoGrip(),
    );
  }

  lockGripReference(): void {
    if (this.#grip.locked) return;
    const before = this.#grip.steady;
    const changed = this.#grip.lockReference();
    if (changed) {
      for (const listener of this.#referenceListeners) listener("scramble-lock");
    } else if (this.#grip.steady && this.#grip.steady !== before) {
      for (const listener of this.#gripListeners) listener(this.#grip.steady);
    }
    this.#tracedGrip = "";
    debugLog(
      "grip",
      this.#grip.active
        ? "scramble finished — reference locked at white top, green front"
        : "scramble finished, but the cube has sent no gyro readings, so there is nothing to lock on to",
    );
    this.#traceGrip();
  }

  /**
   * Write the grip to the trace whenever it changes.
   *
   * Only changes, not every reading: the cube reports its pose many times a second and
   * almost all of those say the same thing.
   */
  #traceGrip(): void {
    if (!debugEnabled("grip")) return;
    this.#traceHeartbeat();
    const snapped = this.#grip.snapped;
    const grip = this.grip;
    if (!snapped || !grip) return;
    const key = `${grip.bottom}${grip.front}`;
    if (key === this.#tracedGrip) return;
    const from = this.#tracedGrip;
    this.#tracedGrip = key;
    debugLog(
      "grip",
      from === "" ? "grip" : `grip ${from} →`,
      `${faceColour(grip.front).name} front, ${faceColour(grip.bottom).name} down`,
      `(${snapped.tokens.join(" ") || "as scrambled"}, m=${snapped.margin.toFixed(2)})`,
    );
  }

  /**
   * Authoritative gyro reference changes, including automatic scramble locking.
   */
  onGyroReferenceChange(listener: (reason: GyroReferenceChangeReason) => void): () => void {
    this.#referenceListeners.add(listener);
    return () => this.#referenceListeners.delete(listener);
  }

  /** Every cube move, for driving the 3D view without going through React state. */
  onCubeMove(listener: (move: string) => void): () => void {
    this.#moveListeners.add(listener);
    return () => this.#moveListeners.delete(listener);
  }

  /**
   * Fires when the cube settles into a different grip.
   *
   * The settled grip, not the latest reading: this drives what is on screen, and a
   * view that followed every reading would flicker as hands moved over the cube.
   */
  onGripChange(listener: (orientation: Orientation) => void): () => void {
    this.#gripListeners.add(listener);
    return () => this.#gripListeners.delete(listener);
  }

  /** How the cube has settled into being held, for drawing it that way. */
  get heldAs(): Orientation | null {
    return this.#grip.steady;
  }

  /** Fires when the cube state is replaced wholesale rather than turned. */
  onPatternReset(listener: (pattern: KPattern) => void): () => void {
    this.#patternListeners.add(listener);
    return () => this.#patternListeners.delete(listener);
  }

  get pattern(): KPattern | null {
    return this.#model?.pattern ?? null;
  }

  // ------------------------------------------------------------------- cube

  connect(macPrompt?: MacPrompt): Promise<void> {
    return this.cube.connect(macPrompt);
  }

  /** True when moves are coming from somewhere — real hardware or the virtual cube. */
  get hasCube(): boolean {
    const { cubeStatus, virtualCube } = this.state.get();
    return cubeStatus === "connected" || virtualCube;
  }

  setVirtualCube(virtualCube: boolean): void {
    this.state.update(state => ({ ...state, virtualCube }));
    this.#dependencies.onPatternChanged(false);
  }
  injectMove(move: string): void {
    if (!parseFaceMove(move)) return;
    const timestamp = performance.now();
    this.handleMove({
      type: "MOVE",
      serial: 0,
      face: 0,
      direction: 0,
      move,
      localTimestamp: timestamp,
      cubeTimestamp: timestamp,
      timestamp,
    } as GanCubeMove & { serial: number });
  }

  disconnect(): Promise<void> {
    return this.cube.disconnect();
  }

  /** Re-read the cube's state, in case the app and the cube disagree. */
  syncFromCube(): Promise<void> {
    if (!this.cube.connected) return Promise.resolve();
    return this.cube.requestFacelets();
  }

  /** Declare the cube solved. Only meaningful when it physically is. */
  async markCubeSolved(): Promise<void> {
    const model = this.#model;
    if (!model || !this.#allowSolvedReset()) return;
    const pattern = model.pattern;
    const connectionRevision = this.#connectionRevision;
    try {
      if (this.cube.connected) await this.cube.requestReset();
    } catch {
      if (connectionRevision === this.#connectionRevision) {
        this.#dependencies.reportError("Could not mark the cube solved. Check the connection and try again.");
      }
      return;
    }
    // New physical facts (including a reset facelet report) already supersede
    // this request's snapshot. Never rewind them when the command completes.
    if (connectionRevision !== this.#connectionRevision || this.#model !== model || model.pattern !== pattern) return;
    if (!this.#allowSolvedReset()) return;
    model.reset();
    this.#publishPattern(true);
  }

  #allowSolvedReset(): boolean {
    const phase = this.#dependencies.getTimerPhase();
    if (phase === "inspection" || phase === "solving" || !this.#dependencies.canReplacePattern()) {
      this.#dependencies.reportError("Cannot mark the cube solved during inspection or an active attempt.");
      return false;
    }
    return true;
  }

  #checkRecentreGesture(move: string, phase: TimerPhase): void {
    if (phase === "solving" || phase === "inspection") {
      this.#recentTurns = [];
      return;
    }
    this.#recentTurns.push(move);
    if (this.#recentTurns.length > RECENTRE_GESTURE_TURNS) this.#recentTurns.shift();
    if (!isRecentreGesture(this.#recentTurns)) return;
    this.#recentTurns = [];
    this.resetGyro();
  }

  receiveFacelets(facelets: string): void {
    const model = this.#model;
    if (!model) return;
    // Trust the cube over our own bookkeeping, but never mid-solve: a state report
    // that arrives late would otherwise rewind moves that have already happened.
    if (!this.#dependencies.canReplacePattern()) return;
    if (model.facelets === facelets) {
      this.#publishPattern(false);
      return;
    }
    try {
      model.setFacelets(facelets);
    } catch {
      return; // A garbled report; the next one will do.
    }
    this.#publishPattern(true);
  }

  #publishPattern(reset: boolean): void {
    if (!this.#model) return;
    this.state.update(state => ({ ...state, cubeFacelets: this.#model!.facelets }));
    if (reset) for (const listener of this.#patternListeners) listener(this.#model.pattern);
    this.#dependencies.onPatternChanged(reset);
  }
}
