import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import type { GanCubeMove } from "gan-web-bluetooth";
import { fitMoveTimestamps, type Quaternion } from "../../infrastructure/bluetooth/smartCube";
import { analyseSolve, isSolvedPattern, type TimedMove } from "../../cube/analysis";
import { faceColour, faceOfColour } from "../../cube/colours";
import { hasXCrossIn } from "../../cube/crossPlans";
import { generateWhiteCrossScramble } from "../../cube/crossScramble";
import { encodeGripTrack, rewriteWithRotations, trackGrip, type GripTrack } from "../../cube/gripTrack";
import { patternToFacelets, type CubeModel } from "../../cube/model";
import type { Face } from "../../cube/moves";
import { rotationForCrossFace, rotationForGrip } from "../../cube/orientation";
import { get3x3x3 } from "../../cube/puzzle";
import { reframe } from "../../cube/recognise";
import { ScrambleTracker, eventInfo, generateScramble, type EventId, type ScrambleProgress } from "../../cube/scramble";
import { solveAlg } from "../../cube/solver";
import { debugEnabled, debugLog } from "../../util/debug";
import { calculateRecovery, type Recovery } from "../../shared/recovery";
import { whiteCrossProvider, xCrossProvider } from "../../app/scrambleProvider";
import { Store } from "../../shared/store";
import type { Settings, Solve } from "../../app/types";

export type TimerPhase = "scrambling" | "ready" | "inspection" | "solving" | "finished";
export type ScrambleAdoptionResult = "applied" | "superseded" | "failed" | "unavailable";
export type ScrambleGeneration = { kind: "cross" } | { kind: "xcross"; attempts: number };
export type TimerState = {
  phase: TimerPhase; scramble: string; scrambleGeneration: ScrambleGeneration | null; scrambleProgress: ScrambleProgress | null;
  recovery: Recovery | null; recoveryPending: boolean; liveMoves: string[]; solveSource: "smartcube" | "keyboard" | null; inspectionPenalty: "none" | "+2" | "DNF"
};
type ScrambleContext = { scramble: string; provider?: string };
export type TimerPhysicalCube = {
  readonly model: CubeModel | null;
  readonly hasCube: boolean;
  readonly pose: Quaternion | null;
  readonly grip: { bottom: Face; front: Face } | null;
  readonly gripReference: Quaternion | null;
  readonly gripLocked: boolean;
  resetGrip(): void;
  holdBottom(bottom: Face | null): void;
  lockGripReference(): void;
};
export type TimerDependencies = {
  physical: TimerPhysicalCube;
  getSettings: () => Settings;
  getEvent: () => EventId;
  getSessionId: () => string;
  isActive: () => boolean;
  contextBusy: () => boolean;
  elapsed: Store<number>;
  inspectionLeft: Store<number | null>;
  startClock: () => void;
  stopClock: () => void;
  reportError: (error: string) => void;
  persistSolve: (solve: Solve) => Promise<void>;
  onSolveRecorded: (solve: Solve) => void;
};
const INSPECTION_MS = 15_000;
const INSPECTION_PLUS2_MS = 17_000;
const XCROSS_ATTEMPTS_FOR_LIMIT = 200;
const XCROSS_ATTEMPTS_FOR_FOUR_MOVES = 2_000;

/** Timer and solve lifecycle; Session persistence remains outside this runtime. */
export class TimerRuntime {
  readonly state = new Store<TimerState>({
    phase: "scrambling", scramble: "", scrambleGeneration: null, scrambleProgress: null,
    recovery: null, recoveryPending: false, liveMoves: [], solveSource: null, inspectionPenalty: "none"
  });
  #tracker: ScrambleTracker | null = null;
  #isReplay = false;
  #scrambleGenerationToken = 0;
  #scrambleProvider: string | undefined;
  #scrambleBeforeSpecialGeneration: ScrambleContext | null = null;
  #startedAt = 0;
  #inspectionStartedAt = 0;
  #solveMoves: GanCubeMove[] = [];
  /** The cube's pose as each move landed, in step with `#solveMoves`. */
  #solveReadings: (Quaternion | null)[] = [];
  #scrambledPattern: KPattern | null = null;
  #recoveryToken = 0;
  #recoveryRunning = false;
  #recoveryNeedsRefresh = false;
  #beeped = new Set<number>();

  constructor(dependencies: TimerDependencies) { this.#dependencies = dependencies; }
  readonly #dependencies: TimerDependencies;
  get #model() { return this.#dependencies.physical.model; }
  get hasCube(): boolean { return this.#dependencies.physical.hasCube; }
  /** Read-only request ownership for conditional cross-runtime follow-up actions. */
  get scrambleRequestRevision(): number { return this.#scrambleGenerationToken; }
  elapsedAt(now: number): number | null { return this.state.get().phase === "solving" ? now - this.#startedAt : null; }
  invalidateScrambleContext(): void {
    this.#scrambleGenerationToken++;
    this.#invalidateRecovery();
    this.#tracker = null;
    this.#scrambleBeforeSpecialGeneration = null;
    this.#scrambleProvider = undefined;
    this.state.update(s => ({ ...s, scrambleGeneration: null, scrambleProgress: null }));
  }
  tick(now: number): boolean {
    const { phase } = this.state.get();
    if (phase === "solving") { this.#dependencies.elapsed.set(now - this.#startedAt); return true; }
    if (phase !== "inspection") return false;
    const spent = now - this.#inspectionStartedAt;
    this.#dependencies.inspectionLeft.set(INSPECTION_MS - spent);
    const penalty = spent > INSPECTION_PLUS2_MS ? "DNF" : spent > INSPECTION_MS ? "+2" : "none";
    if (penalty !== this.state.get().inspectionPenalty) this.state.update((state) => ({ ...state, inspectionPenalty: penalty }));
    if (this.#dependencies.getSettings().sound) this.#inspectionBeeps(spent);
    return true;
  }
  cancelForArea(): void {
    this.#invalidateRecovery();
    this.#scrambleGenerationToken++;
    this.#dependencies.stopClock();
    this.#tracker = null;
    this.#scrambledPattern = null;
    this.#solveMoves = [];
    this.#solveReadings = [];
    this.#isReplay = false;
    this.#dependencies.elapsed.set(0);
    this.#dependencies.inspectionLeft.set(null);
    this.#dependencies.physical.resetGrip();
    this.state.update((s) => ({ ...s, phase: "scrambling", scrambleGeneration: null, scrambleProgress: null, recovery: null, recoveryPending: false, liveMoves: [], solveSource: null, inspectionPenalty: "none" }));
  }

  /** Clear the old scramble before converting the Training position for Timer use. */
  prepareForPhysicalScrambleAdoption(): void {
    this.#invalidateRecovery();
    this.#tracker = null;
    this.state.update(s => ({ ...s, scramble: "", scrambleProgress: null, liveMoves: [] }));
  }

  /** Park timing for historical review without adopting or generating a scramble. */
  parkForReview(): void {
    this.cancelForArea();
    this.state.update(s => ({ ...s, phase: "finished", scramble: "" }));
  }

  async newScramble(): Promise<void> {
    this.#invalidateRecovery();
    this.#tracker = null;
    this.#isReplay = false;
    this.#scrambleProvider = undefined;
    this.#scrambleBeforeSpecialGeneration = null;
    const token = ++this.#scrambleGenerationToken;
    const event = this.#dependencies.getEvent();
    this.state.update((s) => ({ ...s, phase: "scrambling", scramble: "", scrambleGeneration: null, scrambleProgress: null, recovery: null, recoveryPending: false, liveMoves: [], inspectionPenalty: "none" }));
    this.#dependencies.elapsed.set(0);
    this.#dependencies.inspectionLeft.set(null);

    let scramble: string;
    try {
      scramble = await generateScramble(event);
    } catch (error) {
      if (token !== this.#scrambleGenerationToken) return;
      this.#dependencies.reportError(`Could not generate a scramble: ${String(error)}`);
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
    this.#invalidateRecovery();
    this.#scrambleGenerationToken++;
    this.#scrambleBeforeSpecialGeneration = null;
    this.#scrambleProvider = scrambleProvider;
    const kpuzzle = this.#model?.kpuzzle;
    const usesSmartCube = eventInfo(this.#dependencies.getEvent()).smart;
    this.#tracker =
      kpuzzle && usesSmartCube ? new ScrambleTracker(kpuzzle, scramble) : null;
    // A new scramble is about to be applied, so the cube is about to be back in the
    // pose the reference means. Start sighting it again.
    this.#dependencies.physical.resetGrip();
    this.state.update((s) => ({ ...s, scramble, scrambleGeneration: null, phase: "scrambling", scrambleProgress: null, recovery: null, recoveryPending: false, liveMoves: [] }));
    this.reconcilePhysicalState();
  }

  #beginSpecialScrambleGeneration(generation: ScrambleGeneration): void {
    this.#invalidateRecovery();
    this.#scrambleBeforeSpecialGeneration = {
      scramble: this.state.get().scramble,
      provider: this.#scrambleProvider,
    };
    this.#scrambleProvider = undefined;
    this.#tracker = null;
    this.state.update((s) => ({ ...s, phase: "scrambling", scramble: "", scrambleGeneration: generation, scrambleProgress: null, recovery: null, recoveryPending: false, liveMoves: [], inspectionPenalty: "none" }));
    this.#dependencies.elapsed.set(0);
    this.#dependencies.inspectionLeft.set(null);
  }

  cancelSpecialScrambleGeneration(): "restored" | "started" | null {
    if (this.state.get().scrambleGeneration === null) return null;

    this.#scrambleGenerationToken++;
    this.#invalidateRecovery();
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
    const settings = this.#dependencies.getSettings();
    const event = this.#dependencies.getEvent();
    const maxMoves = settings.xCrossMaxMoves;
    const maxAttempts =
      maxMoves === 4 ? XCROSS_ATTEMPTS_FOR_FOUR_MOVES : XCROSS_ATTEMPTS_FOR_LIMIT;

    this.#beginSpecialScrambleGeneration({ kind: "xcross", attempts: 0 });

    const bottom = faceOfColour(settings.crossColour) ?? "D";
    const front = faceOfColour(settings.frontColour);
    const grip = (front && rotationForGrip(bottom, front)) ?? rotationForCrossFace(bottom);
    const rotation = new Alg(grip.tokens.join(" "));

    for (let attempt = 0;attempt < maxAttempts;attempt++) {
      if (token !== this.#scrambleGenerationToken) return;
      let scramble: string;
      try {
        scramble = await generateScramble(event);
      } catch (error) {
        if (token === this.#scrambleGenerationToken) {
          this.state.update((s) => ({ ...s, scrambleGeneration: null }));
          this.#dependencies.reportError(`Could not generate a scramble: ${String(error)}`);
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
      this.state.update((s) => ({ ...s, scrambleGeneration: null }));
      this.#dependencies.reportError(`Could not find an XCross in ${maxMoves} moves after ${maxAttempts} attempts. Try again.`);
    }
  }

  async findWhiteCrossScramble(): Promise<void> {
    const kpuzzle = this.#model?.kpuzzle;
    const settings = this.#dependencies.getSettings();
    const eventId = this.#dependencies.getEvent();
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
        this.state.update((s) => ({ ...s, scrambleGeneration: null }));
        this.#dependencies.reportError(`Could not generate a white-cross scramble: ${String(error)}`);
      }
    }
  }

  /**
   * Adopt whatever the cube currently looks like as the scramble.
   * Handy when the user prefers to scramble by hand, or picks the cube up mid-session.
   */
  async useCubeStateAsScramble(): Promise<ScrambleAdoptionResult> {
    const pattern = this.#model?.pattern;
    if (!pattern) return "unavailable";
    const token = ++this.#scrambleGenerationToken;
    this.#invalidateRecovery();
    this.#tracker = null;
    this.state.update((s) => ({ ...s, scrambleProgress: null, recoveryPending: true }));
    try {
      const scramble = (await solveAlg(pattern)).invert().toString();
      if (token !== this.#scrambleGenerationToken) return "superseded";
      this.setScramble(scramble);
      return "applied";
    } catch (error) {
      if (token !== this.#scrambleGenerationToken) return "superseded";
      this.#dependencies.reportError(String(error));
      return "failed";
    } finally {
      if (token === this.#scrambleGenerationToken) this.state.update((s) => ({ ...s, recoveryPending: false }));
    }
  }

  // ------------------------------------------------------------------ timing

  /** Space bar pressed, or the on-screen button tapped. */
  startFromKeyboard(): void {
    if (!this.#dependencies.isActive()) return;
    if (this.#dependencies.contextBusy()) return;
    const { phase } = this.state.get();
    const settings = this.#dependencies.getSettings();
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
    if (!this.#dependencies.isActive()) return;
    this.#invalidateRecovery();
    this.#isReplay = false;
    const specialCancellation =
      this.cancelSpecialScrambleGeneration();
    if (specialCancellation === null) this.#scrambleGenerationToken++;
    this.#dependencies.stopClock();
    this.#dependencies.elapsed.set(0);
    this.#dependencies.inspectionLeft.set(null);
    this.#solveMoves = [];
    this.#solveReadings = [];
    // Abandoned, so the same applies as when one is finished: stop following the
    // cube until the next scramble is on it.
    this.#dependencies.physical.resetGrip();
    this.state.update((s) => ({ ...s, phase: "scrambling", scrambleGeneration: null, liveMoves: [], solveSource: null, inspectionPenalty: "none" }));
    this.reconcilePhysicalState();
  }

  #startInspection(): void {
    if (!this.#dependencies.isActive()) return;
    if (this.#dependencies.contextBusy()) return;
    this.#invalidateRecovery();
    this.#inspectionStartedAt = performance.now();
    this.#beeped.clear();
    this.state.update((s) => ({ ...s, phase: "inspection", inspectionPenalty: "none" }));
    this.#dependencies.inspectionLeft.set(INSPECTION_MS);
    this.#dependencies.startClock();
  }

  /** `from` is the cube state the solve starts at, before its first move. */
  #startSolve(
    atMs: number,
    from: KPattern | null,
    source: "smartcube" | "keyboard",
  ): void {
    if (this.#dependencies.contextBusy()) return;
    this.#invalidateRecovery();
    this.#scrambledPattern = from;
    this.#startedAt = atMs;
    this.#solveMoves = [];
    this.#solveReadings = [];
    // Inspection is over, so whichever face is underneath now is the one the cross
    // is going on, and it stays there for the solve. Holding the view to it means a
    // reading that drifts can get the side facing the solver wrong, but can never
    // tip the cube over on screen.
    const bottom = this.#dependencies.physical.grip?.bottom ?? null;
    this.#dependencies.physical.holdBottom(bottom);
    if (bottom) {
      debugLog("grip", `solve started with ${faceColour(bottom).name} underneath`);
    }
    this.#dependencies.elapsed.set(0);
    this.#dependencies.inspectionLeft.set(null);
    this.state.update((s) => ({ ...s, phase: "solving", liveMoves: [], solveSource: source }));
    this.#dependencies.startClock();
  }

  #inspectionBeeps(spent: number): void {
    for (const mark of [8000, 12000]) {
      if (spent >= mark && !this.#beeped.has(mark)) {
        this.#beeped.add(mark);
        void import("../../util/sound").then((m) => m.beep(mark === 8000 ? 660 : 880));
      }
    }
  }

  /** Keyboard-timed solves have no move data; the time comes from the host clock. */
  #stopManualSolve(): void {
    const rawMs = performance.now() - this.#startedAt;
    this.#dependencies.stopClock();
    this.#dependencies.elapsed.set(rawMs);
    void this.#recordSolve(rawMs, [], "keyboard");
  }

  handleMove(move: GanCubeMove & { serial: number }, before: KPattern): void {
    const model = this.#model;
    if (!model || !this.#dependencies.isActive()) return;
    const { phase } = this.state.get();
    if (phase === "ready" || phase === "inspection") {
      if (this.#dependencies.contextBusy()) {
        return;
      }
      // The first turn is what starts the clock, and it counts as part of the solve.
      this.#startSolve(performance.now(), before, "smartcube");
      this.#solveMoves = [move];
      this.#solveReadings = [this.#dependencies.physical.pose];
      this.state.update((s) => ({ ...s, liveMoves: [move.move] }));
      return;
    }

    if (phase === "solving") {
      this.#solveMoves.push(move);
      this.#solveReadings.push(this.#dependencies.physical.pose);
      this.state.update((s) => ({ ...s, liveMoves: [...s.liveMoves, move.move] }));
      if (isSolvedPattern(model.pattern)) {
        this.#finishSmartSolve();
      }
      return;
    }

    if (phase === "finished") {
      // Turning the cube after a solve means the user has moved on to the next one.
      void this.newScramble();
    }
  }

  reconcilePhysicalState(): void {
    if (!this.#dependencies.isActive()) return;
    const model = this.#model;
    const tracker = this.#tracker;
    const { phase } = this.state.get();
    const settings = this.#dependencies.getSettings();
    if (!model || !tracker || !this.hasCube) {
      if (tracker && !this.hasCube) this.#invalidateRecovery();
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
      this.#invalidateRecovery();
      // The scramble is on the cube, so it is being held white on top and green in
      // front. This is the one moment in a solve when the pose is known outright, and
      // everything afterwards is measured from it. Deliberately keyed off the scramble
      // rather than off the phase: with auto-inspection off the solver inspects while
      // still in `ready`, and turning the cube over then must be measured, not absorbed.
      this.#dependencies.physical.lockGripReference();
      this.state.update((s) => ({ ...s, recovery: null, recoveryPending: false }));
      if (settings.inspection && settings.autoInspection && !settings.slowSolve) {
        this.#startInspection();
      } else {
        this.state.update((s) => ({ ...s, phase: "ready" }));
      }
      return;
    }

    if (phase === "ready") this.state.update((s) => ({ ...s, phase: "scrambling" }));

    if (progress.onTrack) {
      this.#invalidateRecovery();
      this.state.update((s) => ({ ...s, recovery: null, recoveryPending: false }));
    } else {
      this.#requestRecovery();
    }
  }

  #invalidateRecovery(): void {
    this.#recoveryToken++;
    this.#recoveryNeedsRefresh = false;
    this.state.update(s => ({ ...s, recovery: null, recoveryPending: false }));
  }

  #requestRecovery(): void {
    this.#recoveryToken++;
    this.#recoveryNeedsRefresh = true;
    this.state.update(s => ({ ...s, recovery: null, recoveryPending: true }));
    if (!this.#recoveryRunning) void this.#computeRecovery();
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
    if (!model || !tracker) return;
    const token = this.#recoveryToken;
    const pattern = model.pattern;
    this.#recoveryRunning = true;
    this.#recoveryNeedsRefresh = false;
    try {
      const recovery = await calculateRecovery(pattern, tracker);
      if (token !== this.#recoveryToken || pattern !== this.#model?.pattern) return;
      this.state.update((s) => ({ ...s, recovery }));
    } catch {
      if (token === this.#recoveryToken) {
        this.state.update((s) => ({ ...s, recovery: null }));
      }
    } finally {
      this.#recoveryRunning = false;
      if (this.#recoveryNeedsRefresh) void this.#computeRecovery();
      else if (token === this.#recoveryToken) this.state.update((s) => ({ ...s, recoveryPending: false }));
    }
  }

  #finishSmartSolve(): void {
    this.#dependencies.stopClock();
    // The solve is over; the cube can be turned any way again.
    this.#dependencies.physical.holdBottom(null);
    const raw = this.#solveMoves;
    const offsets = fitMoveTimestamps(raw);
    const timed: TimedMove[] = raw.map((m, i) => ({
      move: m.move,
      t: offsets[i] ?? 0,
    }));
    const rawMs = timed.length ? timed[timed.length - 1].t : 0;
    this.#dependencies.elapsed.set(rawMs);
    if (this.#dependencies.getSettings().sound) {
      void import("../../util/sound").then((m) => m.beep(520, 160));
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
    const reference = this.#dependencies.physical.gripReference;
    if (!reference || !this.#dependencies.physical.gripLocked) return null;
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
    const { scramble, inspectionPenalty } = this.state.get();
    const sessionId = this.#dependencies.getSessionId();
    const settings = this.#dependencies.getSettings();
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
    this.#dependencies.physical.resetGrip();

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

    await this.#dependencies.persistSolve(solve);
    this.state.update((s) => ({ ...s, phase: "finished", solveSource: null, inspectionPenalty: "none" }));
    this.#dependencies.onSolveRecorded(solve);
    void this.newScramble();
  }

}
