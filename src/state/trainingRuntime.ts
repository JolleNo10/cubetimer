import type { KPattern } from "cubing/kpuzzle";
import type { GanCubeMove } from "gan-web-bluetooth";
import { fitMoveTimestamps } from "../bluetooth/smartCube";
import type { SolveStep, TimedMove } from "../cube/analysis";
import type { F2lPosition } from "../cube/f2lCases";
import { buildExactF2lTarget, buildF2lCatalogueTarget, calculateTrainingEfficiency, f2lCatalogueSetupMoves, f2lCubeAlgorithm, f2lHandAlgorithm, f2lTrainingGrip, isF2lTrainingComplete, isStandardF2lBase, type F2lTrainingTarget, type F2lTrainingTargetInfo } from "../cube/f2lTraining";
import { findF2lTrainingCase, type F2lTrainingCase, type F2lTrainingLibrary } from "../cube/f2lTrainingCases";
import { F2L_AGAIN_GESTURE_TURNS, isF2lAgainGesture } from "../cube/gestures";
import { buildExactLastLayerTarget, buildLastLayerCatalogueTarget, isLastLayerTrainingComplete, lastLayerCaseIds, lastLayerTrainingVariants, type LastLayerFamily, type LastLayerTrainingSet, type LastLayerTrainingTarget, type LastLayerTrainingTargetInfo } from "../cube/lastLayerTraining";
import { CubeModel, patternToFacelets } from "../cube/model";
import { parseFaceMove } from "../cube/moves";
import type { Orientation } from "../cube/orientation";
import { ScrambleTracker, type ScrambleProgress } from "../cube/scramble";
import { algBetween } from "../cube/solver";
import { advanceTrainingGuide, buildTrainingGuide, handAlgorithm, handMove, handTimedMoves, trainingGrip, trainingGuideProgress, type TrainingGuide, type TrainingGuideProgress } from "../cube/training";
import { calculateRecovery, type Recovery } from "./recovery";
import { Store } from "./store";
import type { Settings, Solve } from "./types";

export type TrainingFamily = "f2l" | "oll" | "pll";

export type TrainingPhase =
  | "selecting"
  | "preparing"
  | "ready"
  | "solving"
  | "result";

export type TrainingMode = "setup" | "virtual";

export type TrainingResult = {
  moves: string[];
  stm: number;
  elapsedMs: number;
  recommendedStm: number | null;
  recommendedAlg: string | null;
  matchedReferenceRank: number | null;
  delta: number | null;
};

/** Source-compatible names for callers that still refer to the original F2L runtime. */
export type F2lTrainingPhase = TrainingPhase;
export type F2lTrainingMode = TrainingMode;
export type F2lTrainingResult = TrainingResult;

export type TrainingTargetInfo = F2lTrainingTargetInfo | LastLayerTrainingTargetInfo;

export type TrainingTarget = F2lTrainingTarget | LastLayerTrainingTarget;

function isLastLayerTarget(target: TrainingTarget): target is LastLayerTrainingTarget {
  return target.info.family !== "f2l";
}

export type F2lTrainingSelection = { library: F2lTrainingLibrary; position: F2lPosition };

export type TrainingState = {
  family: TrainingFamily;
  mode: TrainingMode;
  f2lSelection: F2lTrainingSelection;
  phase: TrainingPhase;
  target: TrainingTargetInfo | null;
  setup: string;
  setupProgress: ScrambleProgress | null;
  recovery: Recovery | null;
  recoveryPending: boolean;
  liveMoves: string[];
  guide: TrainingGuideProgress | null;
  result: TrainingResult | null;
  displayFacelets: string;
  displayRevision: number;
};

export type F2lTrainingState = TrainingState;

function emptyTrainingState(): TrainingState {
  return {
    family: "f2l",
    mode: "setup",
    f2lSelection: { library: "basic", position: "FR" },
    phase: "selecting",
    target: null,
    setup: "",
    setupProgress: null,
    recovery: null,
    recoveryPending: false,
    liveMoves: [],
    guide: null,
    result: null,
    displayFacelets: "",
    displayRevision: 0,
  };
}

export type TrainingDependencies = {
  getModel: () => CubeModel | null;
  getSettings: () => Settings;
  hasCube: () => boolean;
  isActive: () => boolean;
  elapsed: Store<number>;
  startClock: () => void;
  stopClock: () => void;
  reportError: (error: string) => void;
};

/** The single observable owner of the ephemeral Training lifecycle. */
export class TrainingRuntime {
  readonly state = new Store<TrainingState>(emptyTrainingState());
  #recoveryToken = 0;
  #f2lCase: F2lTrainingCase | null = null;
  #trainingTarget: TrainingTarget | null = null;
  #trainingGuide: TrainingGuide | null = null;
  #trainingTracker: ScrambleTracker | null = null;
  #trainingRawMoves: GanCubeMove[] = [];
  #trainingVirtualPattern: KPattern | null = null;
  #trainingStartedAt = 0;
  #trainingSelectionToken = 0;
  #f2lAgainTurns: string[] = [];

  constructor(readonlyDependencies: TrainingDependencies) {
    this.#dependencies = readonlyDependencies;
  }
  readonly #dependencies: TrainingDependencies;
  get #model(): CubeModel | null { return this.#dependencies.getModel(); }
  get hasCube(): boolean { return this.#dependencies.hasCube(); }

  elapsedAt(now: number): number | null {
    return this.state.get().phase === "solving" ? now - this.#trainingStartedAt : null;
  }

  physicalStateChanged(): void {
    if (this.state.get().mode === "setup" && this.#model) {
      this.state.update((state) => ({ ...state, displayFacelets: this.#model!.facelets }));
    }
    this.reconcilePhysicalState();
  }

  leave(): void {
    const family = this.state.get().family;
    this.reset();
    this.state.set({ ...emptyTrainingState(), family });
  }

  #f2lTarget(): F2lTrainingTarget | null {
    const target = this.#trainingTarget;
    if (!target || isLastLayerTarget(target)) return null;
    return target;
  }

  #lastLayerTarget(): LastLayerTrainingTarget | null {
    const target = this.#trainingTarget;
    if (!target || !isLastLayerTarget(target)) return null;
    return target;
  }

  #trainingGrip(target: TrainingTarget): Orientation {
    return isLastLayerTarget(target)
      ? trainingGrip(target.info)
      : f2lTrainingGrip(target.info);
  }

  async selectF2lCase(caseName: string): Promise<void> {
    this.setTrainingFamily("f2l");
    const f2lCase = findF2lTrainingCase(this.state.get().f2lSelection.library, caseName);
    if (!f2lCase || !this.#model) return;
    this.#f2lCase = f2lCase;
    await this.#prepareTarget(
      this.#buildF2lCatalogueTarget(f2lCase, this.state.get().f2lSelection.position),
    );
  }

  /** Select the family inside the shared Training area. */
  setTrainingFamily(family: TrainingFamily): void {
    if (this.state.get().family === family) return;
    this.reset();
    this.#trainingTarget = null;
    this.state.update((s) => ({ ...s, family, phase: "selecting", target: null, setup: "", setupProgress: null, recovery: null, liveMoves: [], result: null }));
  }

  async selectLastLayerCase(family: LastLayerFamily, caseId: string, catalogue?: LastLayerTrainingSet): Promise<void> {
    const settings = this.#dependencies.getSettings();
    // Historical case tables name Full cases, independently of the user's library
    // preference. Explicit catalogue navigation still uses the same lifecycle.
    const trainingSet = catalogue ?? (family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
    if (!lastLayerCaseIds(family, trainingSet).includes(caseId)) return;
    this.setTrainingFamily(family);
    if (!this.#model) return;
    try {
      await this.#prepareTarget(
        this.#buildRandomLastLayerCatalogueTarget(family, caseId, trainingSet),
      );
    } catch (error) {
      this.#dependencies.reportError(String(error));
    }
  }

  randomTrainingCase(family: LastLayerFamily): void {
    const settings = this.#dependencies.getSettings();
    const cases = lastLayerCaseIds(family, family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
    const caseId = cases[Math.floor(Math.random() * cases.length)];
    if (caseId) void this.selectLastLayerCase(family, caseId);
  }

  #randomAuf(): 0 | 1 | 2 | 3 {
    return Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3;
  }

  #buildRandomLastLayerCatalogueTarget(
    family: LastLayerFamily,
    caseId: string,
    trainingSet: LastLayerTrainingSet,
  ): LastLayerTrainingTarget {
    const kpuzzle = this.#model!.kpuzzle;
    const variants = lastLayerTrainingVariants(kpuzzle, family, caseId, trainingSet);
    const variant = variants.length > 1 ? variants[Math.floor(Math.random() * variants.length)] : variants[0];
    return buildLastLayerCatalogueTarget(kpuzzle, family, caseId, this.#randomAuf(), trainingSet, variant.id);
  }

  async selectF2lPosition(position: F2lPosition): Promise<void> {
    if (this.state.get().target?.origin.kind === "solve-step") return;
    this.state.update((s) => ({ ...s, family: "f2l", f2lSelection: { ...s.f2lSelection, position } }));
    if (!this.#f2lCase || !this.#model) return;
    await this.#prepareTarget(this.#buildF2lCatalogueTarget(this.#f2lCase, position));
  }

  setF2lLibrary(selectedLibrary: F2lTrainingLibrary): void {
    this.setTrainingFamily("f2l");
    if (this.state.get().f2lSelection.library === selectedLibrary) return;
    this.reset();
    this.state.update((s) => ({ ...s, family: "f2l", f2lSelection: { ...s.f2lSelection, library: selectedLibrary } }));
  }

  async practiceF2lStep(solve: Solve, step: SolveStep): Promise<void> {
    await this.practiceSolveStep(solve, step);
  }

  async practiceSolveStep(solve: Solve, step: SolveStep): Promise<void> {
    if (!this.#model) return;
    this.#f2lCase = null;
    try {
      if (step.name === "OLL" || step.name === "PLL") {
        this.setTrainingFamily(step.name === "OLL" ? "oll" : "pll");
        await this.#prepareTarget(buildExactLastLayerTarget(this.#model.kpuzzle, solve, step));
      } else {
        this.setTrainingFamily("f2l");
        await this.#prepareTarget(buildExactF2lTarget(this.#model.kpuzzle, solve, step));
      }
    } catch (error) {
      this.#dependencies.reportError(String(error));
    }
  }

  async setTrainingMode(mode: TrainingMode): Promise<void> {
    const training = this.state.get();
    if (training.mode === mode) return;
    if (training.family === "f2l") {
      await this.setF2lMode(mode);
      return;
    }
    const target = this.#lastLayerTarget();
    this.#trainingSelectionToken++;
    this.#recoveryToken++;
    this.#dependencies.stopClock();
    this.#trainingTracker = null;
    this.#trainingVirtualPattern = null;
    this.#trainingRawMoves = [];
    this.#dependencies.elapsed.set(0);
    this.state.update((s) => ({ ...s, mode }));
    if (target) await this.#prepareTarget(target);
  }

  againTraining(): void {
    if (this.state.get().family === "f2l") this.againF2lTraining();
    else void this.#reloadLastLayerTraining();
  }

  resetTraining(): void {
    this.reset();
    this.#trainingTarget = null;
  }

  async setF2lMode(mode: TrainingMode): Promise<void> {
    const training = this.state.get();
    if (training.mode === mode) return;
    const target = this.#f2lTarget();
    const selectedCase = this.#f2lCase;
    this.#trainingSelectionToken++;
    this.#recoveryToken++;
    this.#dependencies.stopClock();
    this.#trainingTracker = null;
    this.#trainingVirtualPattern = null;
    this.#trainingRawMoves = [];
    this.#f2lAgainTurns = [];
    this.#dependencies.elapsed.set(0);
    this.state.update((s) => ({ ...s, family: "f2l", mode }));
    if (target) {
      const nextTarget = selectedCase && this.#model
        ? this.#buildF2lCatalogueTarget(
          selectedCase,
          this.state.get().f2lSelection.position,
        )
        : target;
      await this.#prepareTarget(nextTarget);
    }
  }

  /** Route the current cube position back to the selected target for another attempt. */
  againF2lTraining(): void {
    void this.#reloadF2lTraining();
  }

  resetF2lTraining(): void {
    this.reset();
  }

  reset(mode: TrainingMode = this.state.get().mode): void {
    const current = this.state.get();
    const selectedPosition = current.f2lSelection.position;
    this.#trainingSelectionToken++;
    this.#recoveryToken++;
    this.#f2lCase = null;
    this.#trainingTarget = null;
    this.#trainingGuide = null;
    this.#trainingTracker = null;
    this.#trainingRawMoves = [];
    this.#trainingVirtualPattern = null;
    this.#f2lAgainTurns = [];
    this.#dependencies.stopClock();
    this.#dependencies.elapsed.set(0);
    this.state.update((s) => ({ ...emptyTrainingState(), family: s.family, mode, f2lSelection: { position: selectedPosition, library: s.f2lSelection.library } }));
  }

  #buildF2lCatalogueTarget(
    f2lCase: F2lTrainingCase,
    position = this.state.get().f2lSelection.position,
  ): F2lTrainingTarget {
    if (!this.#model) throw new Error("No cube model for F2L training");
    const mode = this.state.get().mode;
    const base = mode === "setup" && isStandardF2lBase(this.#model.pattern)
      ? this.#model.pattern
      : undefined;
    return buildF2lCatalogueTarget(this.#model.kpuzzle, f2lCase, position, base);
  }

  async #reloadF2lTraining(preserveResult = false): Promise<void> {
    const currentTarget = this.#f2lTarget();
    if (!currentTarget) return;
    const target = this.#f2lCase && this.#model
      ? this.#buildF2lCatalogueTarget(
        this.#f2lCase,
        this.state.get().f2lSelection.position,
      )
      : currentTarget;
    await this.#prepareTarget(target, preserveResult);
  }

  async #prepareTarget(
    target: TrainingTarget,
    preserveResult = false,
  ): Promise<void> {
    const model = this.#model;
    if (!model) return;
    const token = ++this.#trainingSelectionToken;
    this.#recoveryToken++;
    this.#dependencies.stopClock();
    const mode = this.state.get().mode;
    const captured = model.pattern;
    const capturedFacelets = patternToFacelets(captured);
    const targetFacelets = patternToFacelets(target.pattern);
    this.#trainingTarget = target;
    this.#trainingGuide = buildTrainingGuide(target.pattern, target.info);
    this.#trainingTracker = null;
    this.#trainingRawMoves = [];
    this.#f2lAgainTurns = [];
    this.#trainingVirtualPattern = mode === "virtual" ? target.pattern : null;
    this.#dependencies.elapsed.set(0);
    this.state.update((s) => ({
      ...s,
      family: target.info.family,
      mode,
      f2lSelection: target.info.family === "f2l"
        ? { ...s.f2lSelection, position: target.info.position } : s.f2lSelection,
      phase: mode === "virtual" ? "ready" : "preparing",
      target: target.info,
      setup: "",
      setupProgress: null,
      recovery: null,
      recoveryPending: false,
      liveMoves: [],
      guide: this.#trainingGuide ? trainingGuideProgress(this.#trainingGuide) : null,
      result: preserveResult ? s.result : null,
      displayFacelets: mode === "virtual" || !this.hasCube ? targetFacelets : capturedFacelets,
      displayRevision: s.displayRevision + 1,
    }));

    if (mode === "virtual") return;

    try {
      const grip = trainingGrip(target.info);
      const direct = this.#directF2lSetup(target, captured, model);
      let tracker = direct?.tracker ?? null;
      let displayedSetup = direct?.setup ?? null;

      if (!tracker) {
        const setup = await algBetween(captured, target.pattern);
        if (token !== this.#trainingSelectionToken) return;
        tracker = new ScrambleTracker(model.kpuzzle, setup.toString(), captured);
        displayedSetup = tracker.moves
          .map((move) => handMove(move, grip))
          .join(" ");
      }
      if (token !== this.#trainingSelectionToken) return;
      if (patternToFacelets(model.pattern) !== capturedFacelets) {
        this.reset();
        return;
      }
      this.#trainingTracker = tracker;
      this.state.update((s) => ({
        ...s,
        setup: displayedSetup ?? "",
      }));
      this.reconcilePhysicalState();
    } catch (error) {
      if (token === this.#trainingSelectionToken) {
        this.#dependencies.reportError(String(error));
        this.state.update((s) => ({ ...s, phase: "selecting" }));
      }
    }
  }

  /** Keep the known F2L catalogue setup when the physical base permits it. */
  #directF2lSetup(target: TrainingTarget, captured: KPattern, model: CubeModel): { tracker: ScrambleTracker; setup: string } | null {
    if (isLastLayerTarget(target) || !this.#f2lCase || target.info.origin.kind !== "catalog" || !isStandardF2lBase(captured)) return null;
    const setup = f2lCatalogueSetupMoves(this.#f2lCase, target.info.position);
    if (setup === null) return null;
    const tracker = new ScrambleTracker(model.kpuzzle, f2lCubeAlgorithm(setup, trainingGrip(target.info)), captured);
    return patternToFacelets(tracker.targetPattern) === patternToFacelets(target.pattern) ? { tracker, setup } : null;
  }

  async #reloadLastLayerTraining(preserveResult = false): Promise<void> {
    const target = this.#lastLayerTarget();
    if (!target) return;
    const family = target.info.family;
    const caseId = target.info.origin.kind === "catalog"
      ? target.info.origin.caseId
      : target.info.caseId;
    if (this.#model && caseId) {
      try {
        const next = target.info.origin.kind === "catalog"
          ? this.#buildRandomLastLayerCatalogueTarget(family, caseId, target.info.trainingSet)
          : target;
        await this.#prepareTarget(next, preserveResult);
      } catch (error) {
        this.#dependencies.reportError(String(error));
      }
    }
  }

  reconcilePhysicalState(): void {
    if (!this.#dependencies.isActive()) return;
    const training = this.state.get();
    const model = this.#model;
    const tracker = this.#trainingTracker;
    const target = this.#trainingTarget;
    if (training.mode === "virtual" || !model || !tracker || !target || !this.hasCube) {
      if (training.setupProgress !== null || training.recovery !== null) {
        this.state.update((s) => ({ ...s, setupProgress: null, recovery: null }));
      }
      return;
    }
    if (training.phase !== "preparing" && training.phase !== "ready") return;

    const progress = tracker.update(model.pattern);
    this.state.update((s) => ({ ...s, setupProgress: progress }));
    if (progress.done) {
      this.#recoveryToken++;
      this.state.update((s) => ({ ...s, phase: "ready", recovery: null, recoveryPending: false }));
      return;
    }
    if (training.phase === "ready") {
      this.state.update((s) => ({ ...s, phase: "preparing" }));
    }
    if (progress.onTrack) {
      this.#recoveryToken++;
      this.state.update((s) => ({ ...s, recovery: null, recoveryPending: false }));
    } else {
      void this.#computeTrainingRecovery();
    }
  }

  handleMove(move: GanCubeMove & { serial: number }): void {
    const training = this.state.get();
    const target = this.#trainingTarget;
    if (!target) return;
    if (training.phase === "result") {
      if (!isLastLayerTarget(target) && training.mode === "setup" && this.#observeF2lAgainMove(move.move)) {
        void this.#reloadF2lTraining();
      }
      return;
    }
    if (training.phase !== "ready" && training.phase !== "solving") return;
    const displayMove = handMove(move.move, this.#trainingGrip(target));

    if (training.mode === "virtual") {
      if (!this.#trainingVirtualPattern) return;
      this.#trainingVirtualPattern = this.#trainingVirtualPattern.applyMove(move.move);
      this.state.update((s) => ({ ...s, displayFacelets: patternToFacelets(this.#trainingVirtualPattern!) }));
    }

    if (training.phase === "ready") {
      this.#trainingStartedAt = performance.now();
      this.#trainingRawMoves = [move];
      this.#dependencies.elapsed.set(0);
      this.state.update((s) => ({ ...s, phase: "solving", liveMoves: [displayMove], result: null }));
      this.#dependencies.startClock();
    } else {
      this.#trainingRawMoves.push(move);
      this.state.update((s) => ({ ...s, liveMoves: [...s.liveMoves, displayMove] }));
    }

    const attemptPattern = training.mode === "virtual" ? this.#trainingVirtualPattern : this.#model?.pattern;
    if (this.#trainingGuide && attemptPattern) {
      const guide = advanceTrainingGuide(this.#trainingGuide, attemptPattern, training.guide?.confirmed ?? 0);
      this.state.update((s) => ({ ...s, guide }));
    }

    if (
      this.state.get().phase === "solving" &&
      (() => {
        const pattern = training.mode === "virtual" ? this.#trainingVirtualPattern : this.#model?.pattern;
        return pattern && (isLastLayerTarget(target)
          ? isLastLayerTrainingComplete(target.info, pattern)
          : isF2lTrainingComplete(target, pattern));
      })()
    ) {
      this.#finishTrainingAttempt();
    }
  }

  #observeF2lAgainMove(move: string): boolean {
    const parsed = parseFaceMove(move);
    if (!parsed || parsed.face !== "D" || Math.abs(parsed.amount) !== 1) {
      this.#f2lAgainTurns = [];
      return false;
    }
    if (this.#f2lAgainTurns[0] && this.#f2lAgainTurns[0] !== move) {
      this.#f2lAgainTurns = [];
    }
    this.#f2lAgainTurns.push(move);
    if (this.#f2lAgainTurns.length > F2L_AGAIN_GESTURE_TURNS) {
      this.#f2lAgainTurns.shift();
    }
    if (!isF2lAgainGesture(this.#f2lAgainTurns)) return false;
    this.#f2lAgainTurns = [];
    return true;
  }

  async #computeTrainingRecovery(): Promise<void> {
    const model = this.#model;
    const tracker = this.#trainingTracker;
    const target = this.#trainingTarget;
    if (!model || !tracker || !target || !this.#dependencies.isActive()) return;
    const token = ++this.#recoveryToken;
    this.state.update((s) => ({ ...s, recoveryPending: true }));
    try {
      const rawRecovery = await calculateRecovery(model.pattern, tracker);
      if (token !== this.#recoveryToken) return;
      const grip = this.#trainingGrip(target);
      this.state.update((s) => ({
        ...s,
        recovery: {
          ...rawRecovery,
          alg: isLastLayerTarget(target)
            ? handAlgorithm(rawRecovery.alg, grip)
            : f2lHandAlgorithm(rawRecovery.alg, grip),
        },
      }));
    } catch {
      if (token === this.#recoveryToken) {
        this.state.update((s) => ({ ...s, recovery: null }));
      }
    } finally {
      if (token === this.#recoveryToken) {
        this.state.update((s) => ({ ...s, recoveryPending: false }));
      }
    }
  }

  #finishTrainingAttempt(): void {
    this.#dependencies.stopClock();
    const offsets = fitMoveTimestamps(this.#trainingRawMoves);
    const timed: TimedMove[] = this.#trainingRawMoves.map((move, index) => ({
      move: move.move,
      t: offsets[index] ?? 0,
    }));
    const target = this.#trainingTarget;
    const handTimed = target ? handTimedMoves(timed, this.#trainingGrip(target)) : timed;
    const efficiency = calculateTrainingEfficiency(handTimed, target?.info.references,
      target ? { pattern: target.pattern, trainingRotation: target.info.trainingRotation } : undefined);
    this.#dependencies.elapsed.set(efficiency.elapsedMs);
    const result: TrainingResult = {
      moves: efficiency.moves.map(({ move }) => move),
      stm: efficiency.stm,
      elapsedMs: efficiency.elapsedMs,
      recommendedStm: efficiency.recommendedStm,
      recommendedAlg: target?.info.references[0]?.alg ?? null,
      matchedReferenceRank: efficiency.matchedReferenceRank,
      delta: efficiency.delta,
    };
    this.state.update((s) => ({
      ...s, phase: "result", result,
      guide: s.guide ? { ...s.guide, currentMove: null } : null
    }));
    if (this.state.get().mode === "virtual") {
      if (target && isLastLayerTarget(target)) void this.#reloadLastLayerTraining(true);
      else void this.#reloadF2lTraining(true);
    }
  }

}
