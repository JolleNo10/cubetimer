import type { GanCubeMove } from "gan-web-bluetooth";
import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import { analyseSolve, isSolvedPattern, type TimedMove } from "../cube/analysis";
import { faceOfColour } from "../cube/colours";
import { hasXCrossIn } from "../cube/crossPlans";
import { isRecentreGesture, RECENTRE_GESTURE_TURNS } from "../cube/gestures";
import { parseFaceMove } from "../cube/moves";
import { rotationForCrossFace, rotationForGrip } from "../cube/orientation";
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
import { Store } from "./store";
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

export type AppState = {
  ready: boolean;
  phase: TimerPhase;
  cubeStatus: CubeStatus;
  /** On-screen cube driven from the keyboard, for when no hardware is connected. */
  virtualCube: boolean;
  hardware: CubeHardware | null;
  battery: number | null;
  error: string | null;
  scramble: string;
  scrambleProgress: ScrambleProgress | null;
  /** How to get the cube back onto the scramble after a wrong turn. */
  recovery: { alg: string; resumeAt: number } | null;
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

const INSPECTION_MS = 15_000;
const INSPECTION_PLUS2_MS = 17_000;

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
    phase: "scrambling",
    cubeStatus: "disconnected",
    virtualCube: false,
    hardware: null,
    battery: null,
    error: null,
    scramble: "",
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
  #xCrossToken = 0;
  #rafHandle: number | null = null;
  #startedAt = 0;
  #inspectionStartedAt = 0;
  #solveMoves: GanCubeMove[] = [];
  #scrambledPattern: KPattern | null = null;
  #recoveryToken = 0;
  #beeped = new Set<number>();
  #gyroListeners = new Set<(q: Quaternion) => void>();
  #recentreListeners = new Set<() => void>();
  #recentTurns: string[] = [];
  #moveListeners = new Set<(move: string) => void>();
  #patternListeners = new Set<(pattern: KPattern) => void>();

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
        for (const listener of this.#gyroListeners) listener(q);
      },
      onBattery: (battery) => this.state.update((s) => ({ ...s, battery })),
      onHardware: (hardware) => this.state.update((s) => ({ ...s, hardware })),
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

  onGyro(listener: (q: Quaternion) => void): () => void {
    this.#gyroListeners.add(listener);
    return () => this.#gyroListeners.delete(listener);
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
    this.#updateScrambleProgress();
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
    this.#xCrossToken++;
    const { settings } = this.state.get();
    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
      scramble: "",
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
      this.state.update((s) => ({
        ...s,
        error: `Could not generate a scramble: ${String(error)}`,
      }));
      return;
    }
    this.setScramble(scramble);
  }

  /** Load a scramble and mark the resulting solve as a replay (excluded from stats). */
  replayScramble(scramble: string): void {
    this.#isReplay = true;
    this.setScramble(scramble);
  }

  setScramble(scramble: string): void {
    const kpuzzle = this.#model?.kpuzzle;
    const usesSmartCube = eventInfo(this.state.get().settings.event).smart;
    this.#tracker =
      kpuzzle && usesSmartCube ? new ScrambleTracker(kpuzzle, scramble) : null;
    this.state.update((s) => ({
      ...s,
      scramble,
      phase: "scrambling",
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
    }));
    this.#updateScrambleProgress();
  }

  /**
   * Keep generating scrambles until one has an XCross within the selected move limit,
   * then set that as the current scramble. Cancels automatically if a new scramble
   * is requested while the search is running.
   */
  async findXCrossScramble(): Promise<void> {
    const kpuzzle = this.#model?.kpuzzle;
    if (!kpuzzle) return;

    this.#isReplay = false;
    const token = ++this.#xCrossToken;
    const { settings } = this.state.get();
    const maxMoves = settings.xCrossMaxMoves;

    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
      scramble: "",
      scrambleProgress: null,
      recovery: null,
      liveMoves: [],
      inspectionPenalty: "none",
    }));
    this.elapsed.set(0);
    this.inspectionLeft.set(null);

    const bottom = faceOfColour(settings.crossColour) ?? "D";
    const front = faceOfColour(settings.frontColour);
    const grip = (front && rotationForGrip(bottom, front)) ?? rotationForCrossFace(bottom);
    const rotation = new Alg(grip.tokens.join(" "));

    for (let attempt = 0; attempt < 200; attempt++) {
      if (token !== this.#xCrossToken) return;
      let scramble: string;
      try {
        scramble = await generateScramble(settings.event);
      } catch (error) {
        if (token === this.#xCrossToken) {
          this.state.update((s) => ({
            ...s,
            error: `Could not generate a scramble: ${String(error)}`,
          }));
        }
        return;
      }
      if (token !== this.#xCrossToken) return;

      const scrambledPattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      const oriented = reframe(kpuzzle, scrambledPattern, rotation);

      if (hasXCrossIn(kpuzzle, oriented, maxMoves)) {
        if (token === this.#xCrossToken) this.setScramble(scramble);
        return;
      }
    }

    // 200 misses is extremely unlikely; fall back to whatever was last generated.
    if (token === this.#xCrossToken) await this.newScramble();
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
    this.#isReplay = false;
    this.#xCrossToken++;
    this.#stopLoop();
    this.elapsed.set(0);
    this.inspectionLeft.set(null);
    this.#solveMoves = [];
    this.state.update((s) => ({
      ...s,
      phase: "scrambling",
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
      const { phase, settings } = this.state.get();
      if (phase === "solving") {
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

    const { phase } = this.state.get();
    this.#checkRecentreGesture(move.move, phase);

    if (phase === "ready" || phase === "inspection") {
      // The first turn is what starts the clock, and it counts as part of the solve.
      this.#startSolve(performance.now(), before, "smartcube");
      this.#solveMoves = [move];
      this.state.update((s) => ({ ...s, liveMoves: [move.move] }));
      this.#afterStateChange(false);
      return;
    }

    if (phase === "solving") {
      this.#solveMoves.push(move);
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
    if (this.state.get().phase === "solving") return;
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
    this.state.update((s) => ({ ...s, cubeFacelets: facelets }));
    if (reset) {
      for (const listener of this.#patternListeners) listener(model.pattern);
    }
    this.#updateScrambleProgress();
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
      const [backToLast, straightToEnd] = await Promise.all([
        algBetween(model.pattern, tracker.lastKnownPattern),
        algBetween(model.pattern, tracker.targetPattern),
      ]);
      if (token !== this.#recoveryToken) return;
      const backLength = backToLast.experimentalNumChildAlgNodes();
      const endLength = straightToEnd.experimentalNumChildAlgNodes();
      const recovery =
        backLength <= endLength
          ? { alg: backToLast.toString(), resumeAt: tracker.lastKnownMove }
          : { alg: straightToEnd.toString(), resumeAt: tracker.moves.length };
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

  async #recordSolve(
    rawMs: number,
    moves: TimedMove[],
    source: Solve["source"],
  ): Promise<void> {
    const { sessionId, scramble, settings, inspectionPenalty } = this.state.get();
    const isReplay = this.#isReplay;
    this.#isReplay = false;
    const scrambledPattern =
      this.#scrambledPattern ??
      (await get3x3x3()).defaultPattern().applyAlg(new Alg(scramble));

    const solve: Solve = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: Date.now(),
      rawMs,
      penalty: inspectionPenalty,
      scramble,
      event: settings.event,
      source,
      moves,
      practice: settings.slowSolve || isReplay || undefined,
      replay: isReplay || undefined,
      scrambledFacelets: patternToFacelets(scrambledPattern),
      analysis:
        source === "smartcube" ? analyseSolve(scrambledPattern, moves) : null,
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
    if (changes.xCrossMaxMoves !== undefined) this.#xCrossToken++;
    const settings = normaliseSettings({
      ...this.state.get().settings,
      ...changes,
    });
    this.state.update((s) => ({ ...s, settings }));
    await db.saveSettings(settings);
    if (changes.event) {
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
