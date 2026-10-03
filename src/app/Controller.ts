import type { KPattern } from "cubing/kpuzzle";
import type { GanCubeMove } from "gan-web-bluetooth";
import type { MacPrompt } from "../infrastructure/bluetooth/smartCube";
import type { SolveStep } from "../cube/analysis";
import type { F2lPosition } from "../cube/f2lCases";
import { type F2lTrainingLibrary } from "../cube/f2lTrainingCases";
import {
  lastLayerCaseIds,
  type LastLayerFamily,
  type LastLayerTrainingSet,
} from "../cube/lastLayerTraining";
import { CubeModel } from "../cube/model";
import type { Orientation } from "../cube/orientation";
import {
  DEFAULT_EVENT_ID,
  type EventId
} from "../cube/scramble";
import * as dataTransfer from "../features/data-transfer/dataTransfer";
import * as db from "../infrastructure/persistence/db";
import { PhysicalCubeRuntime, type CubeState } from "./PhysicalCubeRuntime";
import type { SessionContextTransition } from "../features/sessions/sessionService";
import * as sessionService from "../features/sessions/sessionService";
import { normaliseSettings } from "./settings";
import * as solveHistory from "../features/history/solveHistory";
import type { StatisticsSnapshot } from "../features/statistics/state/statistics";
import { Store } from "../shared/store";
import { TimerRuntime, type TimerState } from "../features/timer/TimerRuntime";
import { TrainingRuntime, type TrainingFamily, type TrainingMode } from "../features/training/TrainingRuntime";
import {
  DEFAULT_SETTINGS,
  type Session,
  type Settings,
  type Solve,
} from "./types";

export type AppArea = "timer" | "training" | "statistics";
export type AppState = { ready: boolean; area: AppArea; error: string | null };
export type SessionState = { sessions: Session[]; sessionId: string; solves: Solve[]; lastSolve: Solve | null };
export type AppSnapshot = AppState & CubeState & TimerState & SessionState & { settings: Settings };

/** Composes runtimes and coordinates application routing and persisted context. */
export class Controller {
  readonly state = new Store<AppState>({ ready: false, area: "timer", error: null });
  readonly sessions = new Store<SessionState>({ sessions: [], sessionId: "", solves: [], lastSolve: null });
  readonly settings = new Store<Settings>(DEFAULT_SETTINGS);
  readonly elapsed = new Store<number>(0);
  readonly inspectionLeft = new Store<number | null>(null);
  readonly physical: PhysicalCubeRuntime;
  readonly timer: TimerRuntime;
  readonly training: TrainingRuntime;
  #rafHandle: number | null = null;
  #areaBeforeStatistics: "timer" | "training" | null = null;
  #solveRecordedListeners = new Set<(solve: Solve) => void>();
  #sessionContextBusy = false;
  #sessionMutationQueue: Promise<void> = Promise.resolve();

  constructor(model: CubeModel | null = null) {
    this.physical = new PhysicalCubeRuntime({
      getTimerPhase: () => this.timer.state.get().phase,
      getTimerElapsed: now => this.timer.elapsedAt(now),
      canReplacePattern: () => this.timer.state.get().phase !== "solving" && this.training.state.get().phase !== "solving",
      reportError: error => this.state.update((state) => ({ ...state, error })),
      onMove: (move, before) => this.#routeMove(move, before),
      onPatternChanged: () => this.#reconcilePhysicalState(),
    }, model);
    this.timer = new TimerRuntime({
      physical: this.physical,
      getSettings: () => this.settings.get(),
      getEvent: () => this.#currentEvent(),
      getSessionId: () => this.sessions.get().sessionId,
      isActive: () => this.state.get().area === "timer",
      contextBusy: () => this.#sessionContextBusy,
      elapsed: this.elapsed, inspectionLeft: this.inspectionLeft,
      startClock: () => this.#startLoop(), stopClock: () => this.#stopLoop(),
      reportError: error => this.state.update((state) => ({ ...state, error })),
      persistSolve: async solve => {
        await solveHistory.saveSolve(solve);
        this.sessions.update(state => ({ ...state, lastSolve: solve, solves: [...state.solves, solve] }));
      },
      onSolveRecorded: solve => { for (const listener of this.#solveRecordedListeners) listener(solve); },
    });
    this.training = new TrainingRuntime({
      getModel: () => this.physical.model, getSettings: () => this.settings.get(), hasCube: () => this.physical.hasCube,
      isActive: () => this.state.get().area === "training", elapsed: this.elapsed,
      startClock: () => this.#startLoop(), stopClock: () => this.#stopLoop(),
      reportError: error => this.state.update((state) => ({ ...state, error })),
    });
  }

  /** Read-only composition for synchronous actions; it is not an observable state mirror. */
  snapshot(): AppSnapshot {
    return { ...this.state.get(), ...this.physical.state.get(), ...this.timer.state.get(), ...this.sessions.get(), settings: this.settings.get() };
  }
  get cube() { return this.physical.cube; }
  get pattern() { return this.physical.model?.pattern ?? null; }
  get hasCube(): boolean { return this.physical.hasCube; }
  get grip() { return this.physical.grip; }
  get heldAs() { return this.physical.heldAs; }
  get gripReference() { return this.physical.gripReference; }
  recentreGrip(): void { this.physical.recentreGrip(); }
  onCubeMove(listener: (move: string) => void) { return this.physical.onCubeMove(listener); }
  onPatternReset(listener: (pattern: KPattern) => void) { return this.physical.onPatternReset(listener); }
  onGripChange(listener: (orientation: Orientation) => void) { return this.physical.onGripChange(listener); }
  onRecentreView(listener: () => void) { return this.physical.onRecentreView(listener); }
  onSolveRecorded(listener: (solve: Solve) => void) { this.#solveRecordedListeners.add(listener); return () => { this.#solveRecordedListeners.delete(listener); }; }
  connect(prompt?: MacPrompt): Promise<void> { return this.physical.connect(prompt); }
  disconnect(): Promise<void> { return this.physical.disconnect(); }
  syncFromCube(): Promise<void> { return this.physical.syncFromCube(); }
  markCubeSolved(): Promise<void> { return this.physical.markCubeSolved(); }
  injectMove(move: string): void { this.physical.injectMove(move); }

  #currentSession(): Session | undefined {
    return sessionService.currentSession(this.sessions.get());
  }

  #currentEvent(): EventId {
    return this.#currentSession()?.event ?? DEFAULT_EVENT_ID;
  }

  #canChangeSessionContext(): boolean {
    const current = this.snapshot();
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
    this.#sessionMutationQueue = pending.then(() => { }, () => { });
    return pending;
  }

  async init(): Promise<void> {
    const settings = await db.loadSettings();
    const model = await CubeModel.create();
    this.physical.setModel(model);
    const { sessions, sessionId, solves } = await sessionService.loadInitialContext(model.kpuzzle);
    this.settings.set(settings);
    this.sessions.set({ sessions, sessionId, solves, lastSolve: solves.at(-1) ?? null });
    this.state.update((state) => ({ ...state, ready: true }));
    await this.newScramble();
  }

  setVirtualCube(enabled: boolean): void { this.physical.setVirtualCube(enabled); }

  /** Switch the top-level application area and cancel the other area's live work. */
  setArea(area: AppArea): void {
    if (area === this.state.get().area) return;
    const current = this.snapshot();
    const liveTraining = this.training.state.get().phase === "solving";
    if (area === "statistics") {
      if (current.phase === "inspection" || current.phase === "solving" || liveTraining) return;
      this.#areaBeforeStatistics = current.area === "training" ? "training" : "timer";
      this.state.update((s) => ({ ...s, area: "statistics" }));
      return;
    }
    if (current.area === "statistics") {
      const previous = this.#areaBeforeStatistics;
      this.#areaBeforeStatistics = null;
      if (area === previous) {
        this.state.update((s) => ({ ...s, area }));
        if (area === "training") this.training.reconcilePhysicalState();
        else this.timer.reconcilePhysicalState();
        return;
      }
    }
    if (area === "training") {
      this.timer.cancelForArea();
      this.training.reset("setup");
      this.state.update((s) => ({ ...s, area }));
      this.timer.state.update((s) => ({ ...s, scrambleProgress: null, recovery: null }));
      return;
    }

    this.training.leave();
    this.state.update((s) => ({ ...s, area }));
    this.timer.state.update((s) => ({ ...s, scramble: "", scrambleProgress: null, recovery: null, liveMoves: [] }));
    // Training may leave the physical cube anywhere. Make that current position the
    // next timer scramble so an old timer scramble can never look usable.
    void this.useCubeStateAsScramble().catch(() => void this.newScramble());
  }

  /** Leave Training, including its Statistics detour, without adopting its cube position. */
  returnToTimerReview(): boolean {
    const area = this.state.get().area;
    if (area !== "training" && !(area === "statistics" && this.#areaBeforeStatistics === "training")) return false;
    this.#areaBeforeStatistics = null;
    this.timer.cancelForArea();
    this.training.leave();
    this.state.update((s) => ({ ...s, area: "timer" }));
    this.timer.state.update((s) => ({ ...s, phase: "finished", scramble: "", scrambleProgress: null, recovery: null, liveMoves: [], solveSource: null, inspectionPenalty: "none" }));
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
    const settings = this.settings.get();
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

  newScramble(): Promise<void> { return this.timer.newScramble(); }
  setScramble(scramble: string, provider?: string): void { this.timer.setScramble(scramble, provider); }
  replayScramble(scramble: string, provider?: string): void { this.timer.replayScramble(scramble, provider); }
  findXCrossScramble(): Promise<void> { return this.timer.findXCrossScramble(); }
  findWhiteCrossScramble(): Promise<void> { return this.timer.findWhiteCrossScramble(); }
  useCubeStateAsScramble(): Promise<void> { return this.timer.useCubeStateAsScramble(); }
  startFromKeyboard(): void { this.timer.startFromKeyboard(); }
  cancel(): void {
    if (this.state.get().area === "training") this.training.resetTraining();
    else this.timer.cancel();
  }
  #routeMove(move: GanCubeMove & { serial: number }, before: KPattern): void {
    const area = this.state.get().area;
    if (area === "training") this.training.handleMove(move);
    else if (area === "timer") {
      this.physical.observeTimerMove(move.move, this.timer.state.get().phase);
      this.timer.handleMove(move, before);
    }
  }
  #reconcilePhysicalState(): void {
    const area = this.state.get().area;
    if (area === "training") this.training.physicalStateChanged();
    else if (area === "timer") this.timer.reconcilePhysicalState();
  }
  #startLoop(): void {
    if (this.#rafHandle !== null) return;
    const tick = () => {
      this.#rafHandle = requestAnimationFrame(tick);
      const now = performance.now();
      const area = this.state.get().area;
      if (area === "training") {
        const elapsed = this.training.elapsedAt(now);
        if (elapsed !== null) this.elapsed.set(elapsed);
        else this.#stopLoop();
      } else if (area !== "timer" || !this.timer.tick(now)) this.#stopLoop();
    };
    this.#rafHandle = requestAnimationFrame(tick);
  }
  #stopLoop(): void {
    if (this.#rafHandle !== null) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
  }

  // ------------------------------------------------------------------ solves

  async updateSolve(id: string, changes: Partial<Solve>): Promise<void> {
    const solve = this.sessions.get().solves.find((s) => s.id === id);
    if (!solve) return;
    const updated = await solveHistory.updateSolve(solve, changes);
    this.sessions.update((s) => ({ ...s, solves: s.solves.map((x) => (x.id === id ? updated : x)), lastSolve: s.lastSolve?.id === id ? updated : s.lastSolve }));
  }

  async deleteSolve(id: string): Promise<void> {
    await solveHistory.deleteSolve(id);
    this.sessions.update((s) => {
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
    return solveHistory.loadStatisticsSnapshot(this.physical.model?.kpuzzle);
  }

  async #applySessionContext(
    transition: SessionContextTransition | undefined,
  ): Promise<void> {
    if (!transition) return;
    const { sessions, sessionId, solves, eventChanged } = transition;
    if (eventChanged) {
      this.timer.invalidateScrambleContext();
      this.timer.state.update((s) => ({ ...s, scrambleGeneration: null, scrambleProgress: null, recovery: null }));
    }
    this.sessions.update((s) => ({ ...s, sessions, sessionId, solves, lastSolve: solves[solves.length - 1] ?? null }));
    if (eventChanged) await this.newScramble();
    else if (sessionId) this.timer.reconcilePhysicalState();
  }

  async selectSession(sessionId: string): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.snapshot();
      const transition = await sessionService.selectSession(this.physical.model?.kpuzzle, current, sessionId);
      await this.#applySessionContext(transition);
    });
  }

  async createSession(name: string, event?: EventId): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.snapshot();
      const transition = await sessionService.createSession(this.physical.model?.kpuzzle, current, name, event);
      await this.#applySessionContext(transition);
    });
  }

  async changeEvent(event: EventId): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.snapshot();
      const transition = await sessionService.changeEvent(this.physical.model?.kpuzzle, current, event);
      await this.#applySessionContext(transition);
    });
  }

  async renameSession(id: string, name: string): Promise<void> {
    await this.#queueSessionMutation(async () => {
      const updated = await sessionService.renameSession(this.sessions.get().sessions, id, name);
      if (!updated) return;
      this.sessions.update((s) => ({ ...s, sessions: s.sessions.map((session) => session.id === id ? updated : session) }));
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.#withSessionContextMutation(async () => {
      const current = this.snapshot();
      const transition = await sessionService.deleteSession(this.physical.model?.kpuzzle, current, id);
      if (transition?.sessionId === this.sessions.get().sessionId) {
        this.sessions.update((s) => ({ ...s, sessions: transition.sessions }));
      } else {
        await this.#applySessionContext(transition);
      }
    });
  }

  // ---------------------------------------------------------------- settings

  async updateSettings(changes: Partial<Settings>): Promise<void> {
    const current = this.snapshot();
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
    this.settings.set(settings);
    const specialCancellation = cancelsSpecialGeneration
      ? this.timer.cancelSpecialScrambleGeneration()
      : null;
    await db.saveSettings(settings);
    if (specialCancellation !== "started") this.timer.reconcilePhysicalState();
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
        const result = await dataTransfer.importData(this.physical.model?.kpuzzle, this.snapshot(), json);
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
        const result = await dataTransfer.importSolveCsv(this.physical.model?.kpuzzle, this.snapshot(), text, onProgress);
        await this.#applySessionContext(result.context);
        return { solves: result.solves, sessions: result.sessions };
      });
    } finally {
      this.#endSessionContextMutation();
    }
  }

  async exportSolveCsv(scope: "session" | "all"): Promise<string> {
    const { sessions, solves } = this.snapshot();
    return dataTransfer.exportSolveCsv(scope, sessions, solves);
  }

  dismissError(): void {
    this.state.update((s) => ({ ...s, error: null }));
  }
}
