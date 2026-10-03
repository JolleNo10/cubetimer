import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import type { GanCubeMove } from "gan-web-bluetooth";
import {
SmartCube,
fitMoveTimestamps,
type CubeHardware,
type CubeStatus,
type MacPrompt,
type Quaternion,
} from "../bluetooth/smartCube";
import {
analyseSolve,
isSolvedPattern,
type SolveStep,
type TimedMove,
} from "../cube/analysis";
import { faceColour, faceOfColour } from "../cube/colours";
import { hasXCrossIn } from "../cube/crossPlans";
import { generateWhiteCrossScramble } from "../cube/crossScramble";
import type { F2lPosition } from "../cube/f2lCases";
import { type F2lTrainingLibrary } from "../cube/f2lTrainingCases";
import {
RECENTRE_GESTURE_TURNS,
isRecentreGesture,
} from "../cube/gestures";
import {
encodeGripTrack,
rewriteWithRotations,
trackGrip,
type GripTrack,
} from "../cube/gripTrack";
import { facesAtPositions } from "../cube/gyroGrip";
import {
lastLayerCaseIds,
type LastLayerFamily,
type LastLayerTrainingSet,
} from "../cube/lastLayerTraining";
import { LiveGrip } from "../cube/liveGrip";
import { CubeModel, patternToFacelets } from "../cube/model";
import { parseFaceMove, type Face } from "../cube/moves";
import {
reorientMove,
rotationForCrossFace,
rotationForGrip,
type Orientation,
} from "../cube/orientation";
import { get3x3x3 } from "../cube/puzzle";
import { reframe } from "../cube/recognise";
import {
DEFAULT_EVENT_ID,
ScrambleTracker,
eventInfo,
generateScramble,
type EventId,
type ScrambleProgress,
} from "../cube/scramble";
import { solveAlg } from "../cube/solver";
import { debugEnabled, debugLog } from "../util/debug";
import * as dataTransfer from "./dataTransfer";
import * as db from "./db";
import { calculateRecovery, type Recovery } from "./recovery";
import { whiteCrossProvider, xCrossProvider } from "./scrambleProvider";
import type { SessionContextTransition } from "./sessionService";
import * as sessionService from "./sessionService";
import { normaliseSettings } from "./settings";
import * as solveHistory from "./solveHistory";
import type { StatisticsSnapshot } from "./statistics";
import { Store } from "./store";
import { TrainingRuntime, type TrainingFamily, type TrainingMode } from "./trainingRuntime";
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

export type AppArea = "timer" | "training" | "statistics";

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
};

export type ScrambleGeneration =
  | { kind: "cross" }
  | { kind: "xcross"; attempts: number };

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
  #areaBeforeStatistics: "timer" | "training" | null = null;
  #recentreListeners = new Set<() => void>();
  #recentTurns: string[] = [];
  #moveListeners = new Set<(move: string) => void>();
  #patternListeners = new Set<(pattern: KPattern) => void>();
  #solveRecordedListeners = new Set<(solve: Solve) => void>();
  /** Protect active runtime context while a context transition is pending. */
  #sessionContextBusy = false;
  #sessionMutationQueue: Promise<void> = Promise.resolve();

  readonly training: TrainingRuntime;

  constructor(model: CubeModel | null = null) {
    this.#model = model;
    this.training = new TrainingRuntime({
      getModel: () => this.#model,
      getSettings: () => this.state.get().settings,
      hasCube: () => this.hasCube,
      isActive: () => this.state.get().area === "training",
      elapsed: this.elapsed,
      startClock: () => this.#startLoop(),
      stopClock: () => this.#stopLoop(),
      reportError: (error) => this.state.update((state) => ({ ...state, error })),
    });
  }

  #currentSession(): Session | undefined {
    return sessionService.currentSession(this.state.get());
  }

  #currentEvent(): EventId {
    return this.#currentSession()?.event ?? DEFAULT_EVENT_ID;
  }

  #canChangeSessionContext(): boolean {
    const current = this.state.get();
    return current.phase !== "inspection" &&
      current.phase !== "solving" &&
      this.training.state.get().phase !== "solving";
  }

  #beginSessionContextMutation(): boolean {
    if (this.#sessionContextBusy || !this.#canChangeSessionContext()) return false;
    this.#sessionContextBusy = true;
    return true;
  }

  #endSessionContextMutation(): void {
    this.#sessionContextBusy = false;
  }

  async #withSessionContextMutation<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (!this.#beginSessionContextMutation()) return undefined;
    try {
      return await this.#queueSessionMutation(operation);
    } finally {
      this.#endSessionContextMutation();
    }
  }

  /** Serialize persistence and live application together; failures leave the queue usable. */
  #queueSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#sessionMutationQueue.then(operation);
    this.#sessionMutationQueue = pending.then(() => {}, () => {});
    return pending;
  }

  #invalidateScrambleContext(): void {
    this.#scrambleGenerationToken++;
    this.#tracker = null;
    this.#scrambleBeforeSpecialGeneration = null;
    this.#scrambleProvider = undefined;
  }

  async init(): Promise<void> {
    const settings = await db.loadSettings();
    // History repair needs the puzzle before loading the initial Session context.
    this.#model = await CubeModel.create();
    const { sessions, sessionId, solves } = await sessionService.loadInitialContext(this.#model.kpuzzle);

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
      sessions,
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
    if (this.state.get().area === "training") this.training.reconcilePhysicalState();
    else if (this.state.get().area === "timer") this.#updateScrambleProgress();
    // Statistics deliberately has no live workflow to reconcile.
  }

  /** Switch the top-level application area and cancel the other area's live work. */
  setArea(area: AppArea): void {
    if (area === this.state.get().area) return;
    const current = this.state.get();
    const liveTraining = this.training.state.get().phase === "solving";
    if (area === "statistics") {
      if (current.phase === "inspection" || current.phase === "solving" || liveTraining) return;
      this.#areaBeforeStatistics = current.area === "training" ? "training" : "timer";
      this.state.update((s) => ({ ...s, area: "statistics", cubeFacelets: this.#model?.facelets ?? s.cubeFacelets }));
      return;
    }
    if (current.area === "statistics") {
      const previous = this.#areaBeforeStatistics;
      this.#areaBeforeStatistics = null;
      if (area === previous) {
        this.state.update((s) => ({ ...s, area }));
        if (area === "training") this.training.reconcilePhysicalState();
        else this.#updateScrambleProgress();
        return;
      }
    }
    if (area === "training") {
      this.#cancelTimerForArea();
      this.training.reset("setup");
      this.state.update((s) => ({
        ...s,
        area,
        scrambleProgress: null,
        recovery: null,
      }));
      return;
    }

    this.training.leave();
    this.state.update((s) => ({
      ...s,
      area,
      cubeFacelets: this.#model?.facelets ?? s.cubeFacelets,
      scramble: "",
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
    }));
    // Training may leave the physical cube anywhere. Make that current position the
    // next timer scramble so an old timer scramble can never look usable.
    void this.useCubeStateAsScramble().catch(() => void this.newScramble());
  }

  /** Leave Training, including its Statistics detour, without adopting its cube position. */
  returnToTimerReview(): boolean {
    const area = this.state.get().area;
    if (area !== "training" && !(area === "statistics" && this.#areaBeforeStatistics === "training")) return false;
    this.#areaBeforeStatistics = null;
    this.#cancelTimerForArea();
    this.training.leave();
    this.state.update((s) => ({
      ...s,
      area: "timer",
      cubeFacelets: this.#model?.facelets ?? s.cubeFacelets,
      phase: "finished",
      scramble: "",
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
      solveSource: null,
      inspectionPenalty: "none",
    }));
    return true;
  }

  setTrainingFamily(family: TrainingFamily): void {
    if (this.training.state.get().family === family) return;
    this.setArea("training");
    this.training.setTrainingFamily(family);
  }

  async selectF2lCase(caseName: string): Promise<void> {
    this.setArea("training");
    await this.training.selectF2lCase(caseName);
  }

  async selectLastLayerCase(family: LastLayerFamily, caseId: string, catalogue?: LastLayerTrainingSet): Promise<void> {
    // Validate before changing area, as in the original public action.
    const settings = this.state.get().settings;
    const set = catalogue ?? (family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
    if (!lastLayerCaseIds(family, set).includes(caseId)) return;
    this.setArea("training");
    await this.training.selectLastLayerCase(family, caseId, catalogue);
  }

  randomTrainingCase(family: LastLayerFamily): void {
    this.setArea("training");
    this.training.randomTrainingCase(family);
  }

  selectF2lPosition(position: F2lPosition): Promise<void> { return this.training.selectF2lPosition(position); }
  setF2lLibrary(library: F2lTrainingLibrary): void {
    this.setArea("training");
    this.training.setF2lLibrary(library);
  }
  practiceF2lStep(solve: Solve, step: SolveStep): Promise<void> { return this.practiceSolveStep(solve, step); }
  practiceSolveStep(solve: Solve, step: SolveStep): Promise<void> {
    this.setArea("training");
    return this.training.practiceSolveStep(solve, step);
  }
  setTrainingMode(mode: TrainingMode): Promise<void> { return this.training.setTrainingMode(mode); }
  setF2lMode(mode: TrainingMode): Promise<void> { return this.training.setF2lMode(mode); }
  againTraining(): void { this.training.againTraining(); }
  againF2lTraining(): void { this.training.againF2lTraining(); }
  resetTraining(): void { this.training.resetTraining(); }
  resetF2lTraining(): void { this.training.resetF2lTraining(); }

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
    const event = this.#currentEvent();
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
      scramble = await generateScramble(event);
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
    const usesSmartCube = eventInfo(this.#currentEvent()).smart;
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
    const event = this.#currentEvent();
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
        scramble = await generateScramble(event);
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
    const eventId = this.#currentEvent();
    const event = eventInfo(eventId);
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
        eventId,
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
    if (this.#sessionContextBusy) return;
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
    if (this.state.get().area === "statistics") return;
    if (this.state.get().area === "training") {
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
    if (this.state.get().area !== "timer") return;
    if (this.#sessionContextBusy) return;
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
    if (this.#sessionContextBusy) return;
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
      if (area === "training" && this.training.state.get().phase === "solving") {
        this.elapsed.set(this.training.elapsedAt(performance.now())!);
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
    if (area === "training") {
      this.training.handleMove(move);
      this.#afterStateChange(false);
      return;
    }
    if (area === "statistics") {
      // Statistics is read-only. The physical model still follows the cube so that
      // returning to Timer/Training can reconcile its progress, but no live workflow
      // is allowed to consume this move.
      this.#afterStateChange(false);
      return;
    }
    this.#checkRecentreGesture(move.move, phase);
    this.#traceMove(move.move, phase);

    if (phase === "ready" || phase === "inspection") {
      if (this.#sessionContextBusy) {
        this.#afterStateChange(false);
        return;
      }
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
    if (current.phase === "solving" || this.training.state.get().phase === "solving") return;
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
    if (this.state.get().area !== "training") {
      this.state.update((s) => ({ ...s, cubeFacelets: facelets }));
    }
    if (reset) {
      for (const listener of this.#patternListeners) listener(model.pattern);
    }
    if (this.state.get().area === "training") this.training.physicalStateChanged();
    else if (this.state.get().area === "timer") this.#updateScrambleProgress();
    // Statistics follows the physical model only; it never updates timer/training progress.
  }

  #updateScrambleProgress(): void {
    if (this.state.get().area !== "timer") return;
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
      const recovery = await calculateRecovery(model.pattern, tracker);
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

    await solveHistory.saveSolve(solve);
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
    const updated = await solveHistory.updateSolve(solve, changes);
    this.state.update((s) => ({
      ...s,
      solves: s.solves.map((x) => (x.id === id ? updated : x)),
      lastSolve: s.lastSolve?.id === id ? updated : s.lastSolve,
    }));
  }

  async deleteSolve(id: string): Promise<void> {
    await solveHistory.deleteSolve(id);
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

  /** Read all historical data without changing the active Timer state. */
  async loadStatisticsSnapshot(): Promise<StatisticsSnapshot> {
    return solveHistory.loadStatisticsSnapshot(this.#model?.kpuzzle);
  }

  async #applySessionContext(
    transition: SessionContextTransition | undefined,
  ): Promise<void> {
    if (!transition) return;
    const { sessions, sessionId, solves, eventChanged } = transition;
    if (eventChanged) {
      this.#invalidateScrambleContext();
      this.state.update((s) => ({
        ...s,
        scrambleGeneration: null,
        scrambleProgress: null,
        recovery: null,
      }));
    }
    this.state.update((s) => ({
      ...s,
      sessions,
      sessionId,
      solves,
      lastSolve: solves[solves.length - 1] ?? null,
    }));
    if (eventChanged) await this.newScramble();
    else if (sessionId) this.#updateScrambleProgress();
  }

  async selectSession(sessionId: string): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.state.get();
      const transition = await sessionService.selectSession(this.#model?.kpuzzle, current, sessionId);
      await this.#applySessionContext(transition);
    });
  }

  async createSession(name: string, event?: EventId): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.state.get();
      const transition = await sessionService.createSession(this.#model?.kpuzzle, current, name, event);
      await this.#applySessionContext(transition);
    });
  }

  async changeEvent(event: EventId): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.state.get();
      const transition = await sessionService.changeEvent(this.#model?.kpuzzle, current, event);
      await this.#applySessionContext(transition);
    });
  }

  async renameSession(id: string, name: string): Promise<void> {
    await this.#queueSessionMutation(async () => {
      const updated = await sessionService.renameSession(this.state.get().sessions, id, name);
      if (!updated) return;
      this.state.update((s) => ({
        ...s,
        sessions: s.sessions.map((session) => session.id === id ? updated : session),
      }));
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.state.get();
      const transition = await sessionService.deleteSession(this.#model?.kpuzzle, current, id);
      if (transition?.sessionId === this.state.get().sessionId) {
        this.state.update((s) => ({
          ...s,
          sessions: transition.sessions,
        }));
      } else {
        await this.#applySessionContext(transition);
      }
    });
  }

  // ---------------------------------------------------------------- settings

  async updateSettings(changes: Partial<Settings>): Promise<void> {
    const current = this.state.get();
    const generation = current.scrambleGeneration;
    const cancelsSpecialGeneration =
      generation !== null &&
      (changes.slowSolve === false ||
        (generation.kind === "xcross" &&
          (changes.xCrossMaxMoves !== undefined ||
            changes.crossColour !== undefined ||
            changes.frontColour !== undefined)) ||
        (generation.kind === "cross" &&
          (changes.whiteCrossMoves !== undefined ||
            changes.crossColour !== undefined)));
    const settings = normaliseSettings({
      ...current.settings,
      ...changes,
    });
    const training = this.training.state.get();
    const trainingSetChanged =
      (training.family === "oll" && settings.ollTrainingSet !== current.settings.ollTrainingSet) ||
      (training.family === "pll" && settings.pllTrainingSet !== current.settings.pllTrainingSet);
    if (trainingSetChanged && training.target) this.resetTraining();
    this.state.update((s) => ({
      ...s,
      settings,
    }));
    const specialCancellation = cancelsSpecialGeneration
      ? this.#cancelSpecialScrambleGeneration()
      : null;
    await db.saveSettings(settings);
    if (specialCancellation !== "started") this.#updateScrambleProgress();
  }

  // ------------------------------------------------------------------ backup

  /** Everything the app has stored, as JSON, so a session is never trapped here. */
  async exportData(): Promise<string> {
    return dataTransfer.exportData();
  }

  async importData(json: string): Promise<{ sessions: number; solves: number }> {
    if (!this.#beginSessionContextMutation()) {
      throw new Error("Cannot import while the timer or another Session operation is active.");
    }
    try {
      return await this.#queueSessionMutation(async () => {
        const result = await dataTransfer.importData(this.#model?.kpuzzle, this.state.get(), json);
        await this.#applySessionContext(result.context);
        return { sessions: result.sessions, solves: result.solves };
      });
    } finally {
      this.#endSessionContextMutation();
    }
  }

  async importSolveCsv(
    text: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ solves: number; sessions: number }> {
    if (!this.#beginSessionContextMutation()) {
      throw new Error("Cannot import while the timer or another Session operation is active.");
    }
    try {
      return await this.#queueSessionMutation(async () => {
        const result = await dataTransfer.importSolveCsv(this.#model?.kpuzzle, this.state.get(), text, onProgress);
        await this.#applySessionContext(result.context);
        return { solves: result.solves, sessions: result.sessions };
      });
    } finally {
      this.#endSessionContextMutation();
    }
  }

  async exportSolveCsv(scope: "session" | "all"): Promise<string> {
    const { sessions, solves } = this.state.get();
    return dataTransfer.exportSolveCsv(scope, sessions, solves);
  }

  dismissError(): void {
    this.state.update((s) => ({ ...s, error: null }));
  }
}
