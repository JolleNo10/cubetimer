import type { GanCubeMove } from "gan-web-bluetooth";
import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import {
  analyseSolve,
  isSolvedPattern,
  type SolveStep,
  type TimedMove,
} from "../cube/analysis";
import { faceColour, faceOfColour } from "../cube/colours";
import { hasXCrossIn } from "../cube/crossPlans";
import { generateWhiteCrossScramble } from "../cube/crossScramble";
import { isRecentreGesture, RECENTRE_GESTURE_TURNS } from "../cube/gestures";
import { facesAtPositions } from "../cube/gyroGrip";
import { F2L_CASES } from "../cube/f2lCases";
import {
  encodeGripTrack,
  rewriteWithRotations,
  trackGrip,
  type GripTrack,
} from "../cube/gripTrack";
import { LiveGrip } from "../cube/liveGrip";
import { parseFaceMove, type Face } from "../cube/moves";
import {
  buildExactF2lTarget,
  buildStandardF2lTarget,
  calculateTrainingEfficiency,
  f2lHandAlgorithm,
  f2lHandMove,
  f2lHandTimedMoves,
  f2lTrainingGrip,
  isF2lTrainingComplete,
  type F2lTrainingTarget,
  type F2lTrainingTargetInfo,
} from "../cube/f2lTraining";
import {
  reorientMove,
  rotationForCrossFace,
  rotationForGrip,
  type Orientation,
} from "../cube/orientation";
import { reframe } from "../cube/recognise";
import { CubeModel, patternToFacelets } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import {
  ScrambleTracker,
  eventInfo,
  generateScramble,
  type ScrambleProgress,
} from "../cube/scramble";
import { algBetween, solveAlg } from "../cube/solver";
import {
  SmartCube,
  fitMoveTimestamps,
  type CubeHardware,
  type CubeStatus,
  type MacPrompt,
  type Quaternion,
} from "../bluetooth/smartCube";
import * as db from "./db";
import { rebuildAnalysis } from "./repair";
import { normaliseSettings } from "./settings";
import { countSolveCsvRows, solveCsvBatches, formatSolveCsv } from "./solveCsv";
import { whiteCrossProvider, xCrossProvider } from "./scrambleProvider";
import { Store } from "./store";
import { debugEnabled, debugLog } from "../util/debug";
import {
  DEFAULT_SETTINGS,
  type Session,
  type Settings,
  type Solve,
} from "./types";

export type TimerPhase =
  | "scrambling"
  | "ready"
  | "inspection"
  | "solving"
  | "finished";

export type AppArea = "timer" | "f2l";

export type F2lTrainingPhase =
  | "selecting"
  | "preparing"
  | "ready"
  | "solving"
  | "result";

export type F2lTrainingMode = "setup" | "virtual";

export type F2lTrainingResult = {
  moves: string[];
  stm: number;
  elapsedMs: number;
  referenceStm: number | null;
  delta: number | null;
};

export type Recovery = { alg: string; resumeAt: number };

export type F2lTrainingState = {
  mode: F2lTrainingMode;
  phase: F2lTrainingPhase;
  target: F2lTrainingTargetInfo | null;
  setup: string;
  setupProgress: ScrambleProgress | null;
  recovery: Recovery | null;
  recoveryPending: boolean;
  liveMoves: string[];
  result: F2lTrainingResult | null;
  /** Facelets for the cube shown by F2L Training, when it differs from the timer cube. */
  displayFacelets: string;
  /** Changes only when a target is loaded, so 3D training views can reset cleanly. */
  displayRevision: number;
};

export type AppState = {
  ready: boolean;
  area: AppArea;
  phase: TimerPhase;
  cubeStatus: CubeStatus;
  /** On-screen cube driven from the keyboard, for when no hardware is connected. */
  virtualCube: boolean;
  hardware: CubeHardware | null;
  battery: number | null;
  error: string | null;
  scramble: string;
  scrambleGeneration: ScrambleGeneration | null;
  scrambleProgress: ScrambleProgress | null;
  /** How to get the cube back onto the scramble after a wrong turn. */
  recovery: Recovery | null;
  recoveryPending: boolean;
  cubeFacelets: string;
  liveMoves: string[];
  /** Where the running solve was started from, which decides what can stop it. */
  solveSource: "smartcube" | "keyboard" | null;
  inspectionPenalty: "none" | "+2" | "DNF";
  lastSolve: Solve | null;
  solves: Solve[];
  sessions: Session[];
  sessionId: string;
  settings: Settings;
  f2lTraining: F2lTrainingState;
};

export type ScrambleGeneration =
  | { kind: "cross" }
  | { kind: "xcross"; attempts: number };

function emptyF2lState(): F2lTrainingState {
  return {
    mode: "setup",
    phase: "selecting",
    target: null,
    setup: "",
    setupProgress: null,
    recovery: null,
    recoveryPending: false,
    liveMoves: [],
    result: null,
    displayFacelets: "",
    displayRevision: 0,
  };
}

type ScrambleContext = {
  scramble: string;
  provider?: string;
};

/** How often the grip trace says where it has got to while nothing is changing. */
const GRIP_HEARTBEAT_MS = 2_000;
const INSPECTION_MS = 15_000;
const INSPECTION_PLUS2_MS = 17_000;
// Four-move XCrosses are rare, so the normal retry budget can silently fall back
// to an ordinary scramble before finding one.
const XCROSS_ATTEMPTS_FOR_LIMIT = 200;
const XCROSS_ATTEMPTS_FOR_FOUR_MOVES = 2_000;

/**
 * Everything that is not rendering.
 *
 * Kept outside React because the move stream arrives at up to ~20 events per second and
 * the running time updates every frame; both are pushed through narrow stores so that a
 * turn of the cube does not re-render the whole page.
 */
export class Controller {
  readonly state = new Store<AppState>({
    ready: false,
    area: "timer",
    phase: "scrambling",
    cubeStatus: "disconnected",
    virtualCube: false,
    hardware: null,
    battery: null,
    error: null,
    scramble: "",
    scrambleGeneration: null,
    scrambleProgress: null,
    recovery: null,
    recoveryPending: false,
    cubeFacelets: "",
    liveMoves: [],
    solveSource: null,
    inspectionPenalty: "none",
    lastSolve: null,
    solves: [],
    sessions: [],
    sessionId: "",
    settings: DEFAULT_SETTINGS,
    f2lTraining: emptyF2lState(),
  });

  /** Running time in milliseconds, updated every animation frame while timing. */
  readonly elapsed = new Store<number>(0);
  /** Milliseconds left of inspection, or null when not inspecting. */
  readonly inspectionLeft = new Store<number | null>(null);
  readonly cube = new SmartCube();

  #model: CubeModel | null = null;
  #tracker: ScrambleTracker | null = null;
  #isReplay = false;
  #scrambleGenerationToken = 0;
  #scrambleProvider: string | undefined;
  #scrambleBeforeSpecialGeneration: ScrambleContext | null = null;
  #rafHandle: number | null = null;
  #startedAt = 0;
  #inspectionStartedAt = 0;
  #solveMoves: GanCubeMove[] = [];
  /** The cube's pose as each move landed, in step with `#solveMoves`. */
  #solveReadings: (Quaternion | null)[] = [];
  #scrambledPattern: KPattern | null = null;
  #recoveryToken = 0;
  #beeped = new Set<number>();
  /** Where the cube is pointing, measured against the pose it was scrambled in. */
  #grip = new LiveGrip();
  /** The grip last written to the trace, so only changes are reported. */
  #tracedGrip = "";
  #gripListeners = new Set<(orientation: Orientation) => void>();
  #gyroReadings = 0;
  #gripHeartbeatAt = 0;
  #f2lTarget: F2lTrainingTarget | null = null;
  #f2lTracker: ScrambleTracker | null = null;
  #f2lRawMoves: GanCubeMove[] = [];
  #f2lVirtualPattern: KPattern | null = null;
  #f2lStartedAt = 0;
  #f2lSelectionToken = 0;
  #recentreListeners = new Set<() => void>();
  #recentTurns: string[] = [];
  #moveListeners = new Set<(move: string) => void>();
  #patternListeners = new Set<(pattern: KPattern) => void>();
  #solveRecordedListeners = new Set<(solve: Solve) => void>();

  constructor(model: CubeModel | null = null) {
    this.#model = model;
  }

  async init(): Promise<void> {
    const [settings, sessions] = await Promise.all([
      db.loadSettings(),
      db.loadSessions(),
    ]);
    let allSessions = sessions;
    if (allSessions.length === 0) {
      const session: Session = {
        id: crypto.randomUUID(),
        name: "Session 1",
        event: settings.event,
        createdAt: Date.now(),
      };
      await db.saveSession(session);
      allSessions = [session];
    }
    const sessionId = allSessions[allSessions.length - 1].id;
    // The model has to exist before solves are loaded, since repairing a breakdown
    // needs the puzzle.
    this.#model = await CubeModel.create();
    const solves = await this.#loadSolves(sessionId);

    this.cube.setHandlers({
      onMove: (move) => this.#onMove(move),
      onFacelets: (facelets) => this.#onFacelets(facelets),
      onGyro: (q) => {
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
      onStatus: (cubeStatus, error) =>
        this.state.update((s) => ({
          ...s,
          cubeStatus,
          error: error ?? (cubeStatus === "connected" ? null : s.error),
          hardware: cubeStatus === "connected" ? s.hardware : null,
          battery: cubeStatus === "connected" ? s.battery : null,
        })),
    });

    this.state.update((s) => ({
      ...s,
      ready: true,
      settings,
      sessions: allSessions,
      sessionId,
      solves,
      lastSolve: solves[solves.length - 1] ?? null,
      cubeStatus: this.cube.status,
      cubeFacelets: this.#model!.facelets,
    }));

    await this.newScramble();
  }

  // ---------------------------------------------------------------- listeners

  /**
   * The pose the cube was in when the scramble finished, which is white on top and
   * green in front. Everything that has to know which way the cube is facing — the 3D
   * view included — measures from here, so there is one reference and not several.
   */
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
   * Refused mid-solve. The reference means "white on top, green in front", which is not
   * true of a cube halfway through a solve, and moving it would throw away the readings
   * the reconstruction is built from.
   */
  recentreGrip(): void {
    if (this.state.get().phase === "solving") return;
    this.#grip.reset();
    this.#grip.lockReference();
    this.#tracedGrip = "";
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
        ? `+${Math.round(performance.now() - this.#startedAt)}ms`.padStart(9)
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

  #lockGripReference(): void {
    if (this.#grip.locked) return;
    this.#grip.lockReference();
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
   * Fires when the solver asks, on the cube, for the view to be lined up with how they
   * are holding it.
   */
  onRecentreView(listener: () => void): () => void {
    this.#recentreListeners.add(listener);
    return () => this.#recentreListeners.delete(listener);
  }

  /** Every cube move, for driving the 3D view without going through React state. */
  onCubeMove(listener: (move: string) => void): () => void {
    this.#moveListeners.add(listener);
    return () => this.#moveListeners.delete(listener);
  }

  /** Fires after a solve has been persisted and application state has been updated. */
  onSolveRecorded(listener: (solve: Solve) => void): () => void {
    this.#solveRecordedListeners.add(listener);
    return () => this.#solveRecordedListeners.delete(listener);
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
    this.state.update((s) => ({ ...s, virtualCube }));
    if (this.state.get().area === "f2l") this.#updateF2lProgress();
    else this.#updateScrambleProgress();
  }

  /** Switch the top-level application area and cancel the other area's live work. */
  setArea(area: AppArea): void {
    if (area === this.state.get().area) return;
    if (area === "f2l") {
      this.#cancelTimerForArea();
      this.#resetF2lSnapshot("setup");
      this.state.update((s) => ({
        ...s,
        area,
        scrambleProgress: null,
        recovery: null,
      }));
      return;
    }

    this.#resetF2lSnapshot();
    this.state.update((s) => ({
      ...s,
      area,
      scramble: "",
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
      f2lTraining: emptyF2lState(),
    }));
    // Training may leave the physical cube anywhere. Make that current position the
    // next timer scramble so an old timer scramble can never look usable.
    void this.useCubeStateAsScramble().catch(() => void this.newScramble());
  }

  async selectF2lCase(caseName: string): Promise<void> {
    const f2lCase = F2L_CASES.find((candidate) => candidate.name === caseName);
    if (!f2lCase || !this.#model) return;
    if (this.state.get().area !== "f2l") this.setArea("f2l");
    await this.#selectF2lTarget(buildStandardF2lTarget(this.#model.kpuzzle, f2lCase));
  }

  async practiceF2lStep(solve: Solve, step: SolveStep): Promise<void> {
    if (this.state.get().area !== "f2l") this.setArea("f2l");
    if (!this.#model) return;
    try {
      await this.#selectF2lTarget(buildExactF2lTarget(this.#model.kpuzzle, solve, step));
    } catch (error) {
      this.state.update((s) => ({ ...s, error: String(error) }));
    }
  }

  async setF2lMode(mode: F2lTrainingMode): Promise<void> {
    const training = this.state.get().f2lTraining;
    if (training.mode === mode) return;
    const target = this.#f2lTarget;
    this.#f2lSelectionToken++;
    this.#recoveryToken++;
    this.#stopLoop();
    this.#f2lTracker = null;
    this.#f2lVirtualPattern = null;
    this.#f2lRawMoves = [];
    this.elapsed.set(0);
    this.state.update((s) => ({
      ...s,
      f2lTraining: { ...s.f2lTraining, mode },
    }));
    if (target) await this.#selectF2lTarget(target);
  }

  /** Route the current cube position back to the selected target for another attempt. */
  againF2lTraining(): void {
    if (!this.#f2lTarget) return;
    void this.#selectF2lTarget(this.#f2lTarget);
  }

  resetF2lTraining(): void {
    this.#resetF2lSnapshot();
  }

  #cancelTimerForArea(): void {
    this.#scrambleGenerationToken++;
    this.#stopLoop();
    this.#tracker = null;
    this.#scrambledPattern = null;
    this.#solveMoves = [];
    this.#solveReadings = [];
    this.#isReplay = false;
    this.elapsed.set(0);
    this.inspectionLeft.set(null);
    this.#grip.reset();
    this.#tracedGrip = "";
    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
      scrambleGeneration: null,
      scrambleProgress: null,
      recovery: null,
      recoveryPending: false,
      liveMoves: [],
      solveSource: null,
      inspectionPenalty: "none",
    }));
  }

  #resetF2lSnapshot(mode: F2lTrainingMode = this.state.get().f2lTraining.mode): void {
    this.#f2lSelectionToken++;
    this.#recoveryToken++;
    this.#f2lTarget = null;
    this.#f2lTracker = null;
    this.#f2lRawMoves = [];
    this.#f2lVirtualPattern = null;
    this.#stopLoop();
    this.elapsed.set(0);
    this.state.update((s) => ({
      ...s,
      f2lTraining: { ...emptyF2lState(), mode },
    }));
  }

  async #selectF2lTarget(target: F2lTrainingTarget): Promise<void> {
    const model = this.#model;
    if (!model) return;
    const token = ++this.#f2lSelectionToken;
    const mode = this.state.get().f2lTraining.mode;
    const captured = model.pattern;
    const capturedFacelets = patternToFacelets(captured);
    const targetFacelets = patternToFacelets(target.pattern);
    this.#f2lTarget = target;
    this.#f2lTracker = null;
    this.#f2lRawMoves = [];
    this.#f2lVirtualPattern = mode === "virtual" ? target.pattern : null;
    this.elapsed.set(0);
    this.state.update((s) => ({
      ...s,
      area: "f2l",
      f2lTraining: {
        mode,
        phase: mode === "virtual" ? "ready" : "preparing",
        target: target.info,
        setup: "",
        setupProgress: null,
        recovery: null,
        recoveryPending: false,
        liveMoves: [],
        result: null,
        displayFacelets: mode === "virtual" || !this.hasCube ? targetFacelets : capturedFacelets,
        displayRevision: s.f2lTraining.displayRevision + 1,
      },
    }));

    if (mode === "virtual") return;

    try {
      const setup = await algBetween(captured, target.pattern);
      if (token !== this.#f2lSelectionToken) return;
      if (patternToFacelets(model.pattern) !== capturedFacelets) {
        this.#resetF2lSnapshot();
        return;
      }
      const tracker = new ScrambleTracker(model.kpuzzle, setup.toString(), captured);
      this.#f2lTracker = tracker;
      const grip = f2lTrainingGrip(target.info);
      this.state.update((s) => ({
        ...s,
        f2lTraining: {
          ...s.f2lTraining,
          setup: tracker.moves.map((move) => f2lHandMove(move, grip)).join(" "),
        },
      }));
      this.#updateF2lProgress();
    } catch (error) {
      if (token === this.#f2lSelectionToken) {
        this.state.update((s) => ({
          ...s,
          f2lTraining: { ...s.f2lTraining, phase: "selecting" },
          error: String(error),
        }));
      }
    }
  }

  #updateF2lProgress(): void {
    if (this.state.get().area !== "f2l") return;
    if (this.state.get().f2lTraining.mode === "virtual") return;
    const model = this.#model;
    const tracker = this.#f2lTracker;
    const training = this.state.get().f2lTraining;
    if (!model || !tracker || !this.hasCube) {
      if (training.setupProgress !== null || training.recovery !== null) {
        this.state.update((s) => ({
          ...s,
          f2lTraining: { ...s.f2lTraining, setupProgress: null, recovery: null },
        }));
      }
      return;
    }
    if (training.phase !== "preparing" && training.phase !== "ready") return;

    const progress = tracker.update(model.pattern);
    this.state.update((s) => ({
      ...s,
      f2lTraining: { ...s.f2lTraining, setupProgress: progress },
    }));
    if (progress.done) {
      this.#recoveryToken++;
      this.state.update((s) => ({
        ...s,
        f2lTraining: {
          ...s.f2lTraining,
          phase: "ready",
          recovery: null,
          recoveryPending: false,
        },
      }));
      return;
    }
    if (training.phase === "ready") {
      this.state.update((s) => ({
        ...s,
        f2lTraining: { ...s.f2lTraining, phase: "preparing" },
      }));
    }
    if (progress.onTrack) {
      this.#recoveryToken++;
      this.state.update((s) => ({
        ...s,
        f2lTraining: {
          ...s.f2lTraining,
          recovery: null,
          recoveryPending: false,
        },
      }));
    } else {
      void this.#computeF2lRecovery();
    }
  }

  /**
   * Feed a move in as though it came from a cube. Used by the virtual cube, and it is
   * the seam the end-to-end tests drive the app through.
   */
  injectMove(move: string): void {
    if (!parseFaceMove(move)) return;
    const timestamp = performance.now();
    this.#onMove({
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
    if (this.cube.connected) await this.cube.requestReset();
    this.#model?.reset();
    this.#afterStateChange(true);
  }

  // --------------------------------------------------------------- scrambles

  async newScramble(): Promise<void> {
    this.#isReplay = false;
    this.#scrambleProvider = undefined;
    this.#scrambleBeforeSpecialGeneration = null;
    const token = ++this.#scrambleGenerationToken;
    const { settings } = this.state.get();
    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
      scramble: "",
      scrambleGeneration: null,
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
      inspectionPenalty: "none",
    }));
    this.elapsed.set(0);
    this.inspectionLeft.set(null);

    let scramble: string;
    try {
      scramble = await generateScramble(settings.event);
    } catch (error) {
      if (token !== this.#scrambleGenerationToken) return;
      this.state.update((s) => ({
        ...s,
        error: `Could not generate a scramble: ${String(error)}`,
      }));
      return;
    }
    if (token === this.#scrambleGenerationToken) this.setScramble(scramble);
  }

  /** Load a scramble and mark the resulting solve as a replay (excluded from stats). */
  replayScramble(scramble: string, scrambleProvider?: string): void {
    this.#isReplay = true;
    this.setScramble(scramble, scrambleProvider);
  }

  setScramble(scramble: string, scrambleProvider?: string): void {
    this.#scrambleGenerationToken++;
    this.#scrambleBeforeSpecialGeneration = null;
    this.#scrambleProvider = scrambleProvider;
    const kpuzzle = this.#model?.kpuzzle;
    const usesSmartCube = eventInfo(this.state.get().settings.event).smart;
    this.#tracker =
      kpuzzle && usesSmartCube ? new ScrambleTracker(kpuzzle, scramble) : null;
    // A new scramble is about to be applied, so the cube is about to be back in the
    // pose the reference means. Start sighting it again.
    this.#grip.reset();
    this.#tracedGrip = "";
    this.state.update((s) => ({
      ...s,
      scramble,
      scrambleGeneration: null,
      phase: "scrambling",
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
    }));
    this.#updateScrambleProgress();
  }

  #beginSpecialScrambleGeneration(generation: ScrambleGeneration): void {
    this.#scrambleBeforeSpecialGeneration = {
      scramble: this.state.get().scramble,
      provider: this.#scrambleProvider,
    };
    this.#scrambleProvider = undefined;
    this.#tracker = null;
    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
      scramble: "",
      scrambleGeneration: generation,
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
      inspectionPenalty: "none",
    }));
    this.elapsed.set(0);
    this.inspectionLeft.set(null);
  }

  #cancelSpecialScrambleGeneration(): "restored" | "started" | null {
    if (this.state.get().scrambleGeneration === null) return null;

    this.#scrambleGenerationToken++;
    this.#tracker = null;
    const previousScramble = this.#scrambleBeforeSpecialGeneration;
    this.#scrambleBeforeSpecialGeneration = null;
    this.#scrambleProvider = undefined;
    this.state.update((s) => ({ ...s, scrambleGeneration: null }));

    if (previousScramble?.scramble.trim()) {
      this.setScramble(previousScramble.scramble, previousScramble.provider);
      return "restored";
    } else {
      void this.newScramble();
      return "started";
    }
  }

  /**
   * Keep generating scrambles until one has an XCross within the selected move limit,
   * then set that as the current scramble. Cancels automatically if a new scramble
   * is requested while the search is running.
   */
  async findXCrossScramble(): Promise<void> {
    const kpuzzle = this.#model?.kpuzzle;
    if (!kpuzzle || this.state.get().scrambleGeneration) return;

    this.#isReplay = false;
    const token = ++this.#scrambleGenerationToken;
    const { settings } = this.state.get();
    const maxMoves = settings.xCrossMaxMoves;
    const maxAttempts =
      maxMoves === 4 ? XCROSS_ATTEMPTS_FOR_FOUR_MOVES : XCROSS_ATTEMPTS_FOR_LIMIT;

    this.#beginSpecialScrambleGeneration({ kind: "xcross", attempts: 0 });

    const bottom = faceOfColour(settings.crossColour) ?? "D";
    const front = faceOfColour(settings.frontColour);
    const grip = (front && rotationForGrip(bottom, front)) ?? rotationForCrossFace(bottom);
    const rotation = new Alg(grip.tokens.join(" "));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (token !== this.#scrambleGenerationToken) return;
      let scramble: string;
      try {
        scramble = await generateScramble(settings.event);
      } catch (error) {
        if (token === this.#scrambleGenerationToken) {
          this.state.update((s) => ({
            ...s,
            scrambleGeneration: null,
            error: `Could not generate a scramble: ${String(error)}`,
          }));
        }
        return;
      }
      if (token !== this.#scrambleGenerationToken) return;

      this.state.update((s) =>
        token === this.#scrambleGenerationToken
          ? { ...s, scrambleGeneration: { kind: "xcross", attempts: attempt + 1 } }
          : s,
      );

      const scrambledPattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      const oriented = reframe(kpuzzle, scrambledPattern, rotation);

      if (hasXCrossIn(kpuzzle, oriented, maxMoves)) {
        if (token === this.#scrambleGenerationToken) {
          this.setScramble(scramble, xCrossProvider(maxMoves));
        }
        return;
      }
    }

    if (token === this.#scrambleGenerationToken) {
      this.state.update((s) => ({
        ...s,
        scrambleGeneration: null,
        error: `Could not find an XCross in ${maxMoves} moves after ${maxAttempts} attempts. Try again.`,
      }));
    }
  }

  async findWhiteCrossScramble(): Promise<void> {
    const kpuzzle = this.#model?.kpuzzle;
    const { settings } = this.state.get();
    const event = eventInfo(settings.event);
    if (
      !kpuzzle ||
      !event.smart ||
      event.puzzle !== "3x3x3" ||
      settings.crossColour !== "white" ||
      this.state.get().scrambleGeneration
    ) {
      return;
    }

    this.#isReplay = false;
    const token = ++this.#scrambleGenerationToken;
    const requestedMoves = settings.whiteCrossMoves;
    this.#beginSpecialScrambleGeneration({ kind: "cross" });

    try {
      const scramble = await generateWhiteCrossScramble(
        settings.event,
        requestedMoves,
      );
      if (token === this.#scrambleGenerationToken) {
        this.setScramble(scramble, whiteCrossProvider(requestedMoves));
      }
    } catch (error) {
      if (token === this.#scrambleGenerationToken) {
        this.state.update((s) => ({
          ...s,
          scrambleGeneration: null,
          error: `Could not generate a white-cross scramble: ${String(error)}`,
        }));
      }
    }
  }

  /**
   * Adopt whatever the cube currently looks like as the scramble.
   * Handy when the user prefers to scramble by hand, or picks the cube up mid-session.
   */
  async useCubeStateAsScramble(): Promise<void> {
    const pattern = this.#model?.pattern;
    if (!pattern) return;
    this.state.update((s) => ({ ...s, recoveryPending: true }));
    try {
      const scramble = (await solveAlg(pattern)).invert().toString();
      this.setScramble(scramble);
    } catch (error) {
      this.state.update((s) => ({ ...s, error: String(error) }));
    } finally {
      this.state.update((s) => ({ ...s, recoveryPending: false }));
    }
  }

  // ------------------------------------------------------------------ timing

  /** Space bar pressed, or the on-screen button tapped. */
  startFromKeyboard(): void {
    if (this.state.get().area !== "timer") return;
    const { phase, settings } = this.state.get();
    if (phase === "solving") {
      this.#stopManualSolve();
      return;
    }
    if (phase === "finished") {
      void this.newScramble();
      return;
    }
    if (settings.inspection && !settings.slowSolve && phase !== "inspection") {
      this.#startInspection();
      return;
    }
    this.#startSolve(performance.now(), this.#model?.pattern ?? null, "keyboard");
  }

  /** Discard the running solve without recording it. */
  cancel(): void {
    if (this.state.get().area === "f2l") {
      this.resetF2lTraining();
      return;
    }
    this.#isReplay = false;
    const specialCancellation =
      this.#cancelSpecialScrambleGeneration();
    if (specialCancellation === null) this.#scrambleGenerationToken++;
    this.#stopLoop();
    this.elapsed.set(0);
    this.inspectionLeft.set(null);
    this.#solveMoves = [];
    this.#solveReadings = [];
    // Abandoned, so the same applies as when one is finished: stop following the
    // cube until the next scramble is on it.
    this.#grip.reset();
    this.#tracedGrip = "";
    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
      scrambleGeneration: null,
      liveMoves: [],
      solveSource: null,
      inspectionPenalty: "none",
    }));
    this.#updateScrambleProgress();
  }

  #startInspection(): void {
    this.#inspectionStartedAt = performance.now();
    this.#beeped.clear();
    this.state.update((s) => ({
      ...s,
      phase: "inspection",
      inspectionPenalty: "none",
    }));
    this.inspectionLeft.set(INSPECTION_MS);
    this.#startLoop();
  }

  /** `from` is the cube state the solve starts at, before its first move. */
  #startSolve(
    atMs: number,
    from: KPattern | null,
    source: "smartcube" | "keyboard",
  ): void {
    this.#scrambledPattern = from;
    this.#startedAt = atMs;
    this.#solveMoves = [];
    this.#solveReadings = [];
    // Inspection is over, so whichever face is underneath now is the one the cross
    // is going on, and it stays there for the solve. Holding the view to it means a
    // reading that drifts can get the side facing the solver wrong, but can never
    // tip the cube over on screen.
    const bottom = this.grip?.bottom ?? null;
    this.#grip.holdBottom(bottom);
    if (bottom) {
      debugLog("grip", `solve started with ${faceColour(bottom).name} underneath`);
    }
    this.elapsed.set(0);
    this.inspectionLeft.set(null);
    this.state.update((s) => ({
      ...s,
      phase: "solving",
      liveMoves: [],
      solveSource: source,
    }));
    this.#startLoop();
  }

  #startLoop(): void {
    if (this.#rafHandle !== null) return;
    const tick = () => {
      this.#rafHandle = requestAnimationFrame(tick);
      const { area, phase, settings } = this.state.get();
      if (area === "f2l" && this.state.get().f2lTraining.phase === "solving") {
        this.elapsed.set(performance.now() - this.#f2lStartedAt);
      } else if (area === "timer" && phase === "solving") {
        this.elapsed.set(performance.now() - this.#startedAt);
      } else if (phase === "inspection") {
        const spent = performance.now() - this.#inspectionStartedAt;
        this.inspectionLeft.set(INSPECTION_MS - spent);
        const penalty =
          spent > INSPECTION_PLUS2_MS
            ? "DNF"
            : spent > INSPECTION_MS
              ? "+2"
              : "none";
        if (penalty !== this.state.get().inspectionPenalty) {
          this.state.update((s) => ({ ...s, inspectionPenalty: penalty }));
        }
        if (settings.sound) this.#inspectionBeeps(spent);
      } else {
        this.#stopLoop();
      }
    };
    this.#rafHandle = requestAnimationFrame(tick);
  }

  #stopLoop(): void {
    if (this.#rafHandle !== null) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
  }

  #inspectionBeeps(spent: number): void {
    for (const mark of [8000, 12000]) {
      if (spent >= mark && !this.#beeped.has(mark)) {
        this.#beeped.add(mark);
        void import("../util/sound").then((m) => m.beep(mark === 8000 ? 660 : 880));
      }
    }
  }

  /** Keyboard-timed solves have no move data; the time comes from the host clock. */
  #stopManualSolve(): void {
    const rawMs = performance.now() - this.#startedAt;
    this.#stopLoop();
    this.elapsed.set(rawMs);
    void this.#recordSolve(rawMs, [], "keyboard");
  }

  // -------------------------------------------------------------- cube events

  #onMove(move: GanCubeMove & { serial: number }): void {
    const model = this.#model;
    if (!model) return;
    // Captured before the move is applied: if this turn starts the solve, this is the
    // state the solve begins from, and the move itself is the solve's first move.
    const before = model.pattern;
    model.applyMove(move.move);
    for (const listener of this.#moveListeners) listener(move.move);

    const { area, phase } = this.state.get();
    if (area === "f2l") {
      this.#onF2lMove(move);
      this.#afterStateChange(false);
      return;
    }
    this.#checkRecentreGesture(move.move, phase);
    this.#traceMove(move.move, phase);

    if (phase === "ready" || phase === "inspection") {
      // The first turn is what starts the clock, and it counts as part of the solve.
      this.#startSolve(performance.now(), before, "smartcube");
      this.#solveMoves = [move];
      this.#solveReadings = [this.#grip.pose];
      this.state.update((s) => ({ ...s, liveMoves: [move.move] }));
      this.#afterStateChange(false);
      return;
    }

    if (phase === "solving") {
      this.#solveMoves.push(move);
      this.#solveReadings.push(this.#grip.pose);
      this.state.update((s) => ({
        ...s,
        liveMoves: [...s.liveMoves, move.move],
      }));
      if (isSolvedPattern(model.pattern)) {
        this.#finishSmartSolve();
      }
      this.#afterStateChange(false);
      return;
    }

    if (phase === "finished") {
      // Turning the cube after a solve means the user has moved on to the next one.
      void this.newScramble();
    }
    this.#afterStateChange(false);
  }

  #onF2lMove(move: GanCubeMove & { serial: number }): void {
    const training = this.state.get().f2lTraining;
    if (!this.#f2lTarget) return;
    if (training.phase !== "ready" && training.phase !== "solving") return;
    const displayMove = f2lHandMove(
      move.move,
      f2lTrainingGrip(this.#f2lTarget.info),
    );

    if (training.mode === "virtual") {
      if (!this.#f2lVirtualPattern) return;
      this.#f2lVirtualPattern = this.#f2lVirtualPattern.applyMove(move.move);
      this.state.update((s) => ({
        ...s,
        f2lTraining: {
          ...s.f2lTraining,
          displayFacelets: patternToFacelets(this.#f2lVirtualPattern!),
        },
      }));
    }

    if (training.phase === "ready") {
      this.#f2lStartedAt = performance.now();
      this.#f2lRawMoves = [move];
      this.elapsed.set(0);
      this.state.update((s) => ({
        ...s,
        f2lTraining: {
          ...s.f2lTraining,
          phase: "solving",
          liveMoves: [displayMove],
          result: null,
        },
      }));
      this.#startLoop();
    } else {
      this.#f2lRawMoves.push(move);
      this.state.update((s) => ({
        ...s,
        f2lTraining: {
          ...s.f2lTraining,
          liveMoves: [...s.f2lTraining.liveMoves, displayMove],
        },
      }));
    }

    if (
      this.state.get().f2lTraining.phase === "solving" &&
      isF2lTrainingComplete(
        this.#f2lTarget,
        training.mode === "virtual" ? this.#f2lVirtualPattern! : this.#model!.pattern,
      )
    ) {
      this.#finishF2lAttempt();
    }
  }

  /**
   * Watch for the recentre gesture. It is only offered while nothing is being timed —
   * mid-solve those would be three ordinary turns.
   */
  #checkRecentreGesture(move: string, phase: TimerPhase): void {
    if (phase === "solving" || phase === "inspection") {
      this.#recentTurns = [];
      return;
    }
    this.#recentTurns.push(move);
    if (this.#recentTurns.length > RECENTRE_GESTURE_TURNS) this.#recentTurns.shift();
    if (!isRecentreGesture(this.#recentTurns)) return;
    this.#recentTurns = [];
    for (const listener of this.#recentreListeners) listener();
  }

  #onFacelets(facelets: string): void {
    const model = this.#model;
    if (!model) return;
    // Trust the cube over our own bookkeeping, but never mid-solve: a state report
    // that arrives late would otherwise rewind moves that have already happened.
    const current = this.state.get();
    if (current.phase === "solving" || current.f2lTraining.phase === "solving") return;
    if (model.facelets === facelets) {
      this.#afterStateChange(false);
      return;
    }
    try {
      model.setFacelets(facelets);
    } catch {
      return; // A garbled report; the next one will do.
    }
    this.#afterStateChange(true);
  }

  #afterStateChange(reset: boolean): void {
    const model = this.#model;
    if (!model) return;
    const facelets = model.facelets;
    this.state.update((s) => ({
      ...s,
      cubeFacelets: facelets,
      ...(s.area === "f2l" && s.f2lTraining.mode === "setup"
        ? { f2lTraining: { ...s.f2lTraining, displayFacelets: facelets } }
        : {}),
    }));
    if (reset) {
      for (const listener of this.#patternListeners) listener(model.pattern);
    }
    if (this.state.get().area === "f2l") this.#updateF2lProgress();
    else this.#updateScrambleProgress();
  }

  #updateScrambleProgress(): void {
    const model = this.#model;
    const tracker = this.#tracker;
    const { phase, settings } = this.state.get();
    if (!model || !tracker || !this.hasCube) {
      if (this.state.get().scrambleProgress !== null) {
        this.state.update((s) => ({ ...s, scrambleProgress: null, recovery: null }));
      }
      if (phase === "scrambling" && !settings.requireScramble) {
        this.state.update((s) => ({ ...s, phase: "ready" }));
      }
      return;
    }
    if (phase !== "scrambling" && phase !== "ready") return;

    const progress = tracker.update(model.pattern);
    this.state.update((s) => ({ ...s, scrambleProgress: progress }));

    if (progress.done || !settings.requireScramble) {
      this.#recoveryToken++;
      // The scramble is on the cube, so it is being held white on top and green in
      // front. This is the one moment in a solve when the pose is known outright, and
      // everything afterwards is measured from it. Deliberately keyed off the scramble
      // rather than off the phase: with auto-inspection off the solver inspects while
      // still in `ready`, and turning the cube over then must be measured, not absorbed.
      this.#lockGripReference();
      this.state.update((s) => ({ ...s, recovery: null }));
      if (settings.inspection && settings.autoInspection && !settings.slowSolve) {
        this.#startInspection();
      } else {
        this.state.update((s) => ({ ...s, phase: "ready" }));
      }
      return;
    }

    if (phase === "ready") this.state.update((s) => ({ ...s, phase: "scrambling" }));

    if (progress.onTrack) {
      this.#recoveryToken++;
      this.state.update((s) => ({ ...s, recovery: null, recoveryPending: false }));
    } else {
      void this.#computeRecovery();
    }
  }

  /**
   * Work out how to get the cube back onto the scramble.
   *
   * Two ways back are considered — returning to the last position the cube was known
   * to be at, and jumping straight to the fully scrambled state — and the shorter one
   * wins. After one wrong turn that is a single move, rather than a solve and a
   * re-scramble. The search takes a moment, so results are dropped if the cube moves
   * again meanwhile.
   */
  async #computeRecovery(): Promise<void> {
    const model = this.#model;
    const tracker = this.#tracker;
    if (!model || !tracker || this.state.get().recoveryPending) return;
    const token = ++this.#recoveryToken;
    this.state.update((s) => ({ ...s, recoveryPending: true }));
    try {
      const recovery = await this.#calculateRecovery(model.pattern, tracker);
      if (token !== this.#recoveryToken) return;
      this.state.update((s) => ({ ...s, recovery }));
    } catch {
      if (token === this.#recoveryToken) {
        this.state.update((s) => ({ ...s, recovery: null }));
      }
    } finally {
      this.state.update((s) => ({ ...s, recoveryPending: false }));
    }
  }

  async #computeF2lRecovery(): Promise<void> {
    const model = this.#model;
    const tracker = this.#f2lTracker;
    const target = this.#f2lTarget;
    if (
      !model ||
      !tracker ||
      !target ||
      this.state.get().area !== "f2l"
    ) {
      return;
    }
    const token = ++this.#recoveryToken;
    this.state.update((s) => ({
      ...s,
      f2lTraining: { ...s.f2lTraining, recoveryPending: true },
    }));
    try {
      const rawRecovery = await this.#calculateRecovery(model.pattern, tracker);
      if (token !== this.#recoveryToken) return;
      const recovery = {
        ...rawRecovery,
        alg: f2lHandAlgorithm(rawRecovery.alg, f2lTrainingGrip(target.info)),
      };
      this.state.update((s) => ({
        ...s,
        f2lTraining: { ...s.f2lTraining, recovery },
      }));
    } catch {
      if (token === this.#recoveryToken) {
        this.state.update((s) => ({
          ...s,
          f2lTraining: { ...s.f2lTraining, recovery: null },
        }));
      }
    } finally {
      if (token === this.#recoveryToken) {
        this.state.update((s) => ({
          ...s,
          f2lTraining: { ...s.f2lTraining, recoveryPending: false },
        }));
      }
    }
  }

  async #calculateRecovery(
    current: KPattern,
    tracker: ScrambleTracker,
  ): Promise<Recovery> {
    const [backToLast, straightToEnd] = await Promise.all([
      algBetween(current, tracker.lastKnownPattern),
      algBetween(current, tracker.targetPattern),
    ]);
    const backLength = backToLast.experimentalNumChildAlgNodes();
    const endLength = straightToEnd.experimentalNumChildAlgNodes();
    return backLength <= endLength
      ? { alg: backToLast.toString(), resumeAt: tracker.lastKnownMove }
      : { alg: straightToEnd.toString(), resumeAt: tracker.moves.length };
  }

  #finishSmartSolve(): void {
    this.#stopLoop();
    // The solve is over; the cube can be turned any way again.
    this.#grip.holdBottom(null);
    const raw = this.#solveMoves;
    const offsets = fitMoveTimestamps(raw);
    const timed: TimedMove[] = raw.map((m, i) => ({
      move: m.move,
      t: offsets[i] ?? 0,
    }));
    const rawMs = timed.length ? timed[timed.length - 1].t : 0;
    this.elapsed.set(rawMs);
    if (this.state.get().settings.sound) {
      void import("../util/sound").then((m) => m.beep(520, 160));
    }
    void this.#recordSolve(rawMs, timed, "smartcube");
  }

  #finishF2lAttempt(): void {
    this.#stopLoop();
    const offsets = fitMoveTimestamps(this.#f2lRawMoves);
    const timed: TimedMove[] = this.#f2lRawMoves.map((move, index) => ({
      move: move.move,
      t: offsets[index] ?? 0,
    }));
    const target = this.#f2lTarget;
    const handTimed = target
      ? f2lHandTimedMoves(timed, f2lTrainingGrip(target.info))
      : timed;
    const efficiency = calculateTrainingEfficiency(
      handTimed,
      target?.info.reference,
    );
    this.elapsed.set(efficiency.elapsedMs);
    this.state.update((s) => ({
      ...s,
      f2lTraining: {
        ...s.f2lTraining,
        phase: "result",
        result: {
          moves: efficiency.moves.map(({ move }) => move),
          stm: efficiency.stm,
          elapsedMs: efficiency.elapsedMs,
          referenceStm: efficiency.referenceStm,
          delta: efficiency.delta,
        },
      },
    }));
  }

  /**
   * Work out how the cube was held for every move of the solve just finished.
   *
   * The solve is analysed once first, unaided, purely to find where its steps end.
   * Those are the only places in a solve where the grip is known for certain rather
   * than measured — a solver finishes the cross, and each pair, with the cross face
   * underneath — and they are what keeps a drifting reading honest. They can be had
   * up front because which pieces are solved does not depend on which way the cube
   * was being held, so this first pass finds exactly the same steps as the real one.
   *
   * Null when there is nothing to work from — no gyroscope, or a scramble that was
   * never finished, so no reference to measure against. The analysis falls back to
   * guessing the grip from the solve, as it always did.
   */
  #trackSolveGrip(moves: TimedMove[], scrambled: KPattern): GripTrack | null {
    const reference = this.#grip.reference;
    if (!reference || !this.#grip.locked) return null;
    if (!this.#solveReadings.some(Boolean)) return null;

    const unaided = analyseSolve(scrambled, moves);
    const track = trackGrip({
      moves,
      readings: this.#solveReadings,
      reference,
      crossFace: unaided?.crossFace,
      // The last move of each step, and the first of the solve: after inspection the
      // cross face is already underneath.
      boundaries: [0, ...(unaided?.steps ?? []).map((step) => step.toMove - 1)],
    });
    if (debugEnabled("grip")) {
      debugLog(
        "grip",
        `solve tracked: ${track.inspection.join(" ") || "no inspection turn"} ·`,
        `${rewriteWithRotations(moves, track.orientations).map((m) => m.move).join(" ")}`,
      );
      debugLog("grip", `confidence ${track.confidence.toFixed(2)}`);
      for (const warning of track.warnings) debugLog("grip", `⚠ ${warning}`);
    }
    return track;
  }

  async #recordSolve(
    rawMs: number,
    moves: TimedMove[],
    source: Solve["source"],
  ): Promise<void> {
    const { sessionId, scramble, settings, inspectionPenalty } = this.state.get();
    const scrambleProvider = this.#scrambleProvider;
    const isReplay = this.#isReplay;
    this.#isReplay = false;
    const scrambledPattern =
      this.#scrambledPattern ??
      (await get3x3x3()).defaultPattern().applyAlg(new Alg(scramble));
    const grip =
      source === "smartcube" ? this.#trackSolveGrip(moves, scrambledPattern) : null;
    // The solve is read; nothing is watching the cube again until the next scramble
    // is on it, and the readings taken between now and then are sightings of the
    // pose that scramble will be applied in.
    this.#grip.reset();
    this.#tracedGrip = "";

    const solve: Solve = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: Date.now(),
      rawMs,
      penalty: inspectionPenalty,
      scramble,
      scrambleProvider,
      event: settings.event,
      source,
      moves,
      practice: settings.slowSolve || isReplay || undefined,
      replay: isReplay || undefined,
      slowSolve: settings.slowSolve || undefined,
      scrambledFacelets: patternToFacelets(scrambledPattern),
      // Kept alongside the analysis so the breakdown can be rebuilt later without the
      // cube: the readings themselves are gone, but what they were taken to mean is
      // not, and that is what the move text is written from.
      gripTrack: grip ? encodeGripTrack(grip) : undefined,
      analysis:
        source === "smartcube"
          ? analyseSolve(scrambledPattern, moves, grip)
          : null,
    };

    await db.saveSolve(solve);
    this.state.update((s) => ({
      ...s,
      phase: "finished",
      solveSource: null,
      lastSolve: solve,
      solves: [...s.solves, solve],
      inspectionPenalty: "none",
    }));
    for (const listener of this.#solveRecordedListeners) listener(solve);
    void this.newScramble();
  }

  // ------------------------------------------------------------------ solves

  async updateSolve(id: string, changes: Partial<Solve>): Promise<void> {
    const solve = this.state.get().solves.find((s) => s.id === id);
    if (!solve) return;
    const updated = { ...solve, ...changes };
    await db.saveSolve(updated);
    this.state.update((s) => ({
      ...s,
      solves: s.solves.map((x) => (x.id === id ? updated : x)),
      lastSolve: s.lastSolve?.id === id ? updated : s.lastSolve,
    }));
  }

  async deleteSolve(id: string): Promise<void> {
    await db.deleteSolve(id);
    this.state.update((s) => {
      const solves = s.solves.filter((x) => x.id !== id);
      return {
        ...s,
        solves,
        lastSolve:
          s.lastSolve?.id === id ? (solves[solves.length - 1] ?? null) : s.lastSolve,
      };
    });
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Load a session's solves, rebuilding any breakdown that could not be read.
   *
   * The breakdown is derived from the scramble and the move stream, both of which are
   * stored, so a solve analysed under an older model gets re-analysed rather than
   * losing its detail. Repairs are saved, so each solve is only done once.
   */
  async #loadSolves(sessionId: string): Promise<Solve[]> {
    const solves = await db.loadSolves(sessionId);
    const kpuzzle = this.#model?.kpuzzle;
    if (!kpuzzle) return solves;

    const result: Solve[] = [];
    for (const solve of solves) {
      const rebuilt = rebuildAnalysis(kpuzzle, solve);
      if (rebuilt) {
        await db.saveSolve(rebuilt);
        result.push(rebuilt);
      } else {
        result.push(solve);
      }
    }
    return result;
  }

  async selectSession(sessionId: string): Promise<void> {
    const solves = await this.#loadSolves(sessionId);
    this.state.update((s) => ({
      ...s,
      sessionId,
      solves,
      lastSolve: solves[solves.length - 1] ?? null,
    }));
  }

  async createSession(name: string): Promise<void> {
    const session: Session = {
      id: crypto.randomUUID(),
      name,
      event: this.state.get().settings.event,
      createdAt: Date.now(),
    };
    await db.saveSession(session);
    this.state.update((s) => ({ ...s, sessions: [...s.sessions, session] }));
    await this.selectSession(session.id);
  }

  async renameSession(id: string, name: string): Promise<void> {
    const session = this.state.get().sessions.find((s) => s.id === id);
    if (!session) return;
    const updated = { ...session, name };
    await db.saveSession(updated);
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.map((x) => (x.id === id ? updated : x)),
    }));
  }

  async deleteSession(id: string): Promise<void> {
    const { sessions } = this.state.get();
    if (sessions.length <= 1) return;
    await db.deleteSession(id);
    const remaining = sessions.filter((s) => s.id !== id);
    this.state.update((s) => ({ ...s, sessions: remaining }));
    if (this.state.get().sessionId === id) {
      await this.selectSession(remaining[remaining.length - 1].id);
    }
  }

  // ---------------------------------------------------------------- settings

  async updateSettings(changes: Partial<Settings>): Promise<void> {
    const generation = this.state.get().scrambleGeneration;
    const cancelsSpecialGeneration =
      generation !== null &&
      (changes.event !== undefined ||
        changes.slowSolve === false ||
        (generation.kind === "xcross" &&
          (changes.xCrossMaxMoves !== undefined ||
            changes.crossColour !== undefined ||
            changes.frontColour !== undefined)) ||
        (generation.kind === "cross" &&
          (changes.whiteCrossMoves !== undefined ||
            changes.crossColour !== undefined)));
    if (changes.event !== undefined && !cancelsSpecialGeneration) {
      this.#scrambleGenerationToken++;
    }
    const settings = normaliseSettings({
      ...this.state.get().settings,
      ...changes,
    });
    this.state.update((s) => ({
      ...s,
      settings,
    }));
    const specialCancellation = cancelsSpecialGeneration
      ? this.#cancelSpecialScrambleGeneration()
      : null;
    await db.saveSettings(settings);
    if (changes.event && specialCancellation !== "started") {
      await this.newScramble();
    } else {
      this.#updateScrambleProgress();
    }
  }

  // ------------------------------------------------------------------ backup

  /** Everything the app has stored, as JSON, so a session is never trapped here. */
  async exportData(): Promise<string> {
    const [sessions, solves] = await Promise.all([
      db.loadSessions(),
      db.loadAllSolves(),
    ]);
    return JSON.stringify(
      { format: "cubetimer", version: 1, exportedAt: Date.now(), sessions, solves },
      null,
      2,
    );
  }

  /**
   * Merge an exported file back in. Sessions and solves keep their ids, so importing
   * the same file twice does not duplicate anything.
   */
  async importData(json: string): Promise<{ sessions: number; solves: number }> {
    const data = JSON.parse(json) as {
      sessions?: Session[];
      solves?: Solve[];
    };
    if (!Array.isArray(data.sessions) || !Array.isArray(data.solves)) {
      throw new Error("This does not look like a cubetimer export.");
    }
    for (const session of data.sessions) {
      if (session?.id && session.name) await db.saveSession(session);
    }
    let solves = 0;
    for (const solve of data.solves) {
      if (!solve?.id || !solve.sessionId || typeof solve.rawMs !== "number") continue;
      await db.saveSolve({ ...solve, moves: solve.moves ?? [] });
      solves++;
    }
    this.state.update((s) => ({ ...s, sessions: [] }));
    const sessions = await db.loadSessions();
    this.state.update((s) => ({ ...s, sessions }));
    await this.selectSession(this.state.get().sessionId);
    return { sessions: data.sessions.length, solves };
  }

  /**
   * Import a solve analysis CSV export.
   *
   * Solves keep their original ids, so importing the same archive twice updates rather
   * than duplicates. Work is done in batches with a yield between them, so a very large
   * archive imports without locking up the page.
   */
  async importSolveCsv(
    text: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ solves: number; sessions: number }> {
    const total = countSolveCsvRows(text);
    const sessionIds = new Set<string>();
    let done = 0;

    for (const batch of solveCsvBatches(text)) {
      for (const session of batch.sessions) {
        if (sessionIds.has(session.id)) continue;
        sessionIds.add(session.id);
        await db.saveSession(session);
      }
      for (const solve of batch.solves) await db.saveSolve(solve);
      done += batch.solves.length;
      onProgress?.(done, total);
      // Let the browser paint between batches.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const sessions = await db.loadSessions();
    this.state.update((s) => ({ ...s, sessions }));
    await this.selectSession(this.state.get().sessionId);
    return { solves: done, sessions: sessionIds.size };
  }

  /** Write the current session, or everything, in the solve analysis CSV format. */
  async exportSolveCsv(scope: "session" | "all"): Promise<string> {
    const { sessions, solves } = this.state.get();
    const names = new Map(sessions.map((s) => [s.id, s.name]));
    const rows = scope === "all" ? await db.loadAllSolves() : solves;
    const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt);
    return formatSolveCsv(ordered, names);
  }

  dismissError(): void {
    this.state.update((s) => ({ ...s, error: null }));
  }
}
