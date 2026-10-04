import type { KPattern } from "cubing/kpuzzle";
import type { GanCubeMove } from "gan-web-bluetooth";
import { fitMoveTimestamps } from "../../infrastructure/bluetooth/smartCube";
import type { SolveStep, TimedMove } from "../../cube/analysis";
import type { F2lPosition } from "../../cube/f2lCases";
import { buildExactF2lTarget, buildF2lCatalogueTarget, resolveF2lTrainingReference, calculateTrainingEfficiency, f2lCatalogueSetupMoves, f2lCubeAlgorithm, f2lHandAlgorithm, f2lTrainingGrip, isF2lTrainingComplete, isStandardF2lBase, type F2lTrainingTarget, type F2lTrainingTargetInfo } from "../../cube/f2lTraining";
import { findF2lTrainingCase, f2lTrainingCatalogue, type F2lTrainingCase, type F2lTrainingLibrary } from "../../cube/f2lTrainingCases";
import { F2L_AGAIN_GESTURE_TURNS, isF2lAgainGesture } from "../../cube/gestures";
import { buildExactLastLayerTarget, buildLastLayerCatalogueTarget, resolveLastLayerTrainingReference, isLastLayerTrainingComplete, lastLayerCaseIds, lastLayerTrainingVariants, type LastLayerFamily, type LastLayerTrainingSet, type LastLayerTrainingTarget, type LastLayerTrainingTargetInfo } from "../../cube/lastLayerTraining";
import { CubeModel, patternToFacelets } from "../../cube/model";
import { parseFaceMove } from "../../cube/moves";
import type { Orientation } from "../../cube/orientation";
import { ScrambleTracker, type ScrambleProgress } from "../../cube/scramble";
import { algBetween } from "../../cube/solver";
import { handAlgorithm, handMove, handTimedMoves } from "../../cube/frames";
import { advanceTrainingGuide, buildTrainingGuide, trainingGrip, trainingGuideProgress, type TrainingGuide, type TrainingGuideProgress, type TrainingResolvedReference, type TrainingAuf } from "../../cube/training";
import { calculateRecovery, type Recovery } from "../../shared/recovery";
import { Store } from "../../shared/store";
import { drillCatalogue, drillCaseId, selectDrillCase, weakDrillCases, selectRecognitionDrillCase, recognitionChoices, recognitionCasePool, weakRecognitionDrillCases, type TrainingDrillContext, type TrainingDrillState, type TrainingDrillStrategy } from "./trainingDrill";
import { catalogueIdentityForTarget, trainingCatalogueKey } from "../../app/trainingCatalogue";
import { recognitionIsCorrect } from "./trainingRecognitionPerformance";
import type { CompletedTrainingRecognition } from "./trainingRecognitionHistory";
import type { Settings, Solve, TrainingAttempt, TrainingRecognitionAttempt, TrainingDrillTask } from "../../app/types";

export type TrainingFamily = "f2l" | "oll" | "pll";

export type TrainingPhase =
  | "selecting"
  | "preparing"
  | "ready"
  | "solving"
  | "result";

export type TrainingActivity = "single" | "drill";
export const DRILL_COUNTDOWN_MS = 2000;

/** Answers are revealed only after a Drill round ends. */
export function concealsTrainingAnswer(state: TrainingState): boolean {
  return state.activity === "drill" && state.drill.running && (state.phase === "ready" || state.phase === "solving");
}

export type TrainingMode = "setup" | "virtual";

export type TrainingResult = {
  moves: string[];
  stm: number;
  /** Registered move span: first registered move to last registered move. */
  elapsedMs: number;
  /** Drill case reveal to detected completion; null for Single. */
  caseTimeMs: number | null;
  recommendedStm: number | null;
  recommendedAlg: string | null;
  matchedReferenceRank: number | null;
  delta: number | null;
  preferredAlg: string | null;
  preferredStm: number | null;
  matchedPreferred: boolean | null;
  preferredDelta: number | null;
};

export type TrainingTargetInfo = F2lTrainingTargetInfo | LastLayerTrainingTargetInfo;

export type TrainingTarget = F2lTrainingTarget | LastLayerTrainingTarget;

export type CompletedTrainingAttempt = {
  activity: TrainingActivity;
  mode: TrainingMode;
  target: TrainingTargetInfo;
  result: TrainingResult;
  drillRunId?: string | null;
  drillRound?: number | null;
};

function isLastLayerTarget(target: TrainingTarget): target is LastLayerTrainingTarget {
  return target.info.family !== "f2l";
}

export type F2lTrainingSelection = { library: F2lTrainingLibrary; position: F2lPosition };

export type TrainingState = {
  activity: TrainingActivity;
  drill: TrainingDrillState;
  family: TrainingFamily;
  mode: TrainingMode;
  f2lSelection: F2lTrainingSelection;
  phase: TrainingPhase;
  target: TrainingTargetInfo | null;
  preferredReference: { alg: string; stm: number } | null;
  setup: string;
  setupProgress: ScrambleProgress | null;
  recovery: Recovery | null;
  recoveryPending: boolean;
  liveMoves: string[];
  guide: TrainingGuideProgress | null;
  result: TrainingResult | null;
  recognition: { choices: { caseId: string; label: string; group: string }[];
    result: { correctCaseId: string; answerCaseId: string; correct: boolean; responseMs: number } | null } | null;
  displayFacelets: string;
  displayRevision: number;
};

function emptyTrainingState(): TrainingState {
  return {
    activity: "single",
    drill: { task: "execution", runId: null, strategy: "sequence", selectedCaseIds: [], running: false, status: "configuring", outcomes: [], round: 0, context: null, lastCaseId: null, lastOutcome: null },
    family: "f2l",
    mode: "setup",
    f2lSelection: { library: "basic", position: "FR" },
    phase: "selecting",
    target: null,
    preferredReference: null,
    setup: "",
    setupProgress: null,
    recovery: null,
    recoveryPending: false,
    liveMoves: [],
    guide: null,
    result: null,
    recognition: null,
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
  getTrainingAlgorithmPreference?: (key: string) => { algorithm: string } | null;
  getTrainingAttempts?: () => readonly TrainingAttempt[];
  getTrainingRecognitionAttempts?: () => readonly TrainingRecognitionAttempt[];
  createId?: () => string;
  onRecognitionCompleted?: (fact: CompletedTrainingRecognition) => void;
  rng?: () => number;
  now?: () => number;
  onAttemptCompleted?: (attempt: CompletedTrainingAttempt) => void;
};

/** The single observable owner of the ephemeral Training lifecycle. */
export class TrainingRuntime {
  readonly state = new Store<TrainingState>(emptyTrainingState());
  readonly drillCountdown = new Store<number | null>(null);
  #drillCountdownUntil: number | null = null;
  #caseRevealedAt: number | null = null;
  #recoveryToken = 0;
  #f2lCase: F2lTrainingCase | null = null;
  #trainingTarget: TrainingTarget | null = null;
  #trainingGuide: TrainingGuide | null = null;
  #preferredReference: TrainingResolvedReference | null = null;
  #trainingTracker: ScrambleTracker | null = null;
  #trainingRawMoves: GanCubeMove[] = [];
  #trainingVirtualPattern: KPattern | null = null;
  #trainingStartedAt = 0;
  #trainingSelectionToken = 0;
  #f2lAgainTurns: string[] = [];
  #previousVariations = new Map<string, number>();

  constructor(readonlyDependencies: TrainingDependencies) {
    this.#dependencies = readonlyDependencies;
  }
  readonly #dependencies: TrainingDependencies;
  get #model(): CubeModel | null { return this.#dependencies.getModel(); }
  #now(): number { return this.#dependencies.now?.() ?? performance.now(); }
  randomSample(): number {
    const sample = (this.#dependencies.rng ?? Math.random)();
    return Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 0;
  }
  #random(): number { return this.randomSample(); }
  #draw(size: number): number { return Math.floor(this.#random() * size); }
  #variation(key: string, variants = 1): { variant: number; auf: TrainingAuf } {
    let index = (variants > 1 ? this.#draw(variants) : 0) * 4 + this.#draw(4);
    if (this.#previousVariations.get(key) === index && variants * 4 > 1) index = (index + 1) % (variants * 4);
    this.#previousVariations.set(key, index);
    return { variant: Math.floor(index / 4), auf: (index % 4) as TrainingAuf };
  }
  get hasCube(): boolean { return this.#dependencies.hasCube(); }

  elapsedAt(now: number): number | null {
    return this.state.get().phase === "solving" ? now - this.#trainingStartedAt : null;
  }

  /** The Controller's single RAF drives both attempt elapsed and Drill countdown. */
  tick(now: number): boolean {
    const training = this.state.get();
    if (training.drill.running && this.#drillCountdownUntil !== null) {
      const remaining = Math.max(0, this.#drillCountdownUntil - now);
      this.drillCountdown.set(remaining);
      if (remaining === 0) {
        this.#drillCountdownUntil = null;
        this.drillCountdown.set(null);
        this.#revealDrillCase();
      }
    }
    const current = this.state.get();
    if (current.drill.running && this.#caseRevealedAt !== null && current.phase === "solving") {
      this.#dependencies.elapsed.set(Math.max(0, now - this.#caseRevealedAt));
    } else {
      const elapsed = this.elapsedAt(now);
      if (elapsed !== null) this.#dependencies.elapsed.set(elapsed);
    }
    return this.#drillCountdownUntil !== null || current.phase === "solving";
  }

  setTrainingActivity(activity: TrainingActivity): void {
    if (this.state.get().activity === activity) return;
    this.reset();
    this.state.update(s => ({ ...s, activity }));
  }

  #drillContext(): TrainingDrillContext {
    const { family, f2lSelection } = this.state.get();
    const settings = this.#dependencies.getSettings();
    return family === "f2l" ? { family, ...f2lSelection } :
      { family, trainingSet: family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet };
  }

  get drillConfigurationContext(): TrainingDrillContext { return this.#drillContext(); }

  /** Hydrate configuration only; no target, countdown or saved-preset identity. */
  applyDrillConfiguration(context: TrainingDrillContext, caseIds: readonly string[], strategy: TrainingDrillStrategy, task: TrainingDrillTask = "execution"): void {
    if (this.state.get().drill.status !== "configuring") return;
    this.reset("virtual");
    this.state.update(s => ({ ...s, activity: "drill", family: context.family,
      f2lSelection: context.family === "f2l" ? { library: context.library, position: context.position } : s.f2lSelection,
      drill: { ...s.drill, strategy, task, selectedCaseIds: drillCatalogue(context).map(drillCaseId).filter(id => caseIds.includes(id)) },
    }));
  }

  setDrillCases(caseIds: readonly string[]): void {
    if (this.state.get().activity !== "drill" || this.state.get().drill.status !== "configuring") return;
    const selectedCaseIds = drillCatalogue(this.#drillContext()).map(drillCaseId).filter(id => caseIds.includes(id));
    this.state.update(s => ({ ...s, drill: { ...s.drill, selectedCaseIds } }));
  }

  toggleDrillCase(caseId: string): void {
    const selected = this.state.get().drill.selectedCaseIds;
    this.setDrillCases(selected.includes(caseId) ? selected.filter(id => id !== caseId) : [...selected, caseId]);
  }

  setDrillStrategy(strategy: TrainingDrillStrategy): void {
    if (this.state.get().drill.status !== "configuring") return;
    this.state.update(s => ({ ...s, drill: { ...s.drill, strategy } }));
  }

  setDrillTask(task: TrainingDrillTask): void {
    if (this.state.get().drill.status !== "configuring") return;
    this.state.update(s => ({ ...s, drill: { ...s.drill, task } }));
  }

  startDrill(): void {
    const state = this.state.get();
    if (state.activity !== "drill" || state.drill.status !== "configuring" || state.drill.selectedCaseIds.length < (state.drill.task === "recognition" ? 2 : 1) || !this.#model) return;
    const context = this.#drillContext();
    this.reset("virtual");
    this.state.update(s => ({ ...s, drill: { ...s.drill, running: true, status: "running", context, runId: (this.#dependencies.createId ?? (() => crypto.randomUUID()))() } }));
    this.#beginDrillCountdown();
  }

  #beginDrillCountdown(): void {
    this.#drillCountdownUntil = this.#now() + DRILL_COUNTDOWN_MS;
    this.drillCountdown.set(DRILL_COUNTDOWN_MS);
    this.#dependencies.startClock();
  }

  #revealDrillCase(): void {
    const { drill } = this.state.get();
    if (!drill.running || !drill.context || !this.#model) return;
    const cases = drillCatalogue(drill.context).filter(c => drill.selectedCaseIds.includes(drillCaseId(c)));
    const selected = drill.task === "recognition"
      ? selectRecognitionDrillCase(cases, drill.strategy, drill.round, drill.lastCaseId,
        this.#dependencies.getTrainingRecognitionAttempts?.() ?? [], () => this.#random(), drill.outcomes)
      : selectDrillCase(cases, drill.strategy, drill.round, drill.lastCaseId,
        this.#dependencies.getTrainingAttempts?.() ?? [], () => this.#random(), drill.outcomes);
    if (!selected) { this.stopDrill(); return; }
    try {
      let target: TrainingTarget;
      if (selected.family === "f2l") {
        this.#f2lCase = findF2lTrainingCase(selected.library, selected.caseName)!;
        target = this.#buildF2lCatalogueTarget(this.#f2lCase, selected.position);
      } else {
        target = this.#buildRandomLastLayerCatalogueTarget(selected.family, selected.caseId, selected.trainingSet);
      }
      this.state.update(s => ({ ...s, drill: { ...s.drill, round: s.drill.round + 1, lastCaseId: drillCaseId(selected), lastOutcome: null } }));
      // Virtual preparation publishes synchronously and never replaces the physical model.
      const recognition = drill.task === "recognition" ? { choices: recognitionChoices(cases, selected, () => this.#random()), result: null } : null;
      void this.#prepareTarget(target, false, recognition);
    } catch (error) {
      this.stopDrill();
      this.#dependencies.reportError(String(error));
    }
  }

  submitTrainingRecognition(answerCaseId: string): void {
    const state = this.state.get(), identity = catalogueIdentityForTarget(state.target);
    if (!state.drill.running || state.drill.task !== "recognition" || state.phase !== "ready" ||
        !state.recognition?.choices.some(c => c.caseId === answerCaseId) || !identity ||
        this.#caseRevealedAt === null || !state.drill.runId || !state.drill.lastCaseId) return;
    const completedAt = this.#now(), responseMs = Math.max(0, completedAt - this.#caseRevealedAt);
    const correct = recognitionIsCorrect({ target: identity, answerCaseId });
    this.state.update(s => ({ ...s, phase: "result", recognition: { choices: s.recognition!.choices,
      result: { correctCaseId: state.drill.lastCaseId!, answerCaseId, correct, responseMs } },
      drill: { ...s.drill, lastOutcome: correct ? "correct" : "incorrect", outcomes: [...s.drill.outcomes,
        { caseId: state.drill.lastCaseId!, outcome: "answered", answerCaseId, correct, responseMs, completedAt }] } }));
    this.#dependencies.onRecognitionCompleted?.({ drillRunId: state.drill.runId, drillRound: state.drill.round,
      target: identity, answerCaseId, responseMs });
    this.#beginDrillCountdown();
  }

  skipDrillCase(): void {
    const state = this.state.get();
    if (!state.drill.running || state.phase !== "ready" || state.liveMoves.length) return;
    this.#dependencies.stopClock();
    this.state.update(s => ({ ...s, phase: "result", drill: { ...s.drill, lastOutcome: "skipped", outcomes: [...s.drill.outcomes,
        { caseId: s.drill.lastCaseId!, outcome: "skipped", completedAt: this.#now() }] },
      guide: s.guide ? { ...s.guide, currentMove: null } : null }));
    this.#beginDrillCountdown();
  }

  stopDrill(): void {
    const { activity, drill } = this.state.get();
    if (activity !== "drill" || !drill.running) return;
    this.reset("virtual");
    if (drill.outcomes.length) this.state.update(s => ({ ...s, drill: { ...drill, running: false, status: "summary" } }));
  }

  /** Summary actions configure the next run; only Start begins its countdown. */
  finishDrillSummary(weakOnly = false): void {
    const { drill } = this.state.get();
    if (drill.status !== "summary" || !drill.context) return;
    const cases = drillCatalogue(drill.context).filter(c => drill.selectedCaseIds.includes(drillCaseId(c)));
    let weakIds = weakOnly ? (drill.task === "recognition"
      ? weakRecognitionDrillCases(cases, drill.outcomes, this.#dependencies.getTrainingRecognitionAttempts?.() ?? [])
      : weakDrillCases(cases, drill.outcomes, this.#dependencies.getTrainingAttempts?.() ?? [])).map(c => c.caseId) : drill.selectedCaseIds;
    if (weakOnly && !weakIds.length) return;
    if (drill.task === "recognition") {
      const pool = recognitionCasePool(cases, weakIds);
      if (!pool) return;
      weakIds = pool.caseIds;
    }
    const compatible = JSON.stringify(drill.context) === JSON.stringify(this.#drillContext());
    // Settings may change while a captured summary is open. Never reinterpret its pool.
    if (!compatible && drill.task === "recognition") return;
    this.reset("virtual");
    this.state.update(s => ({ ...s, drill: { ...s.drill,
      selectedCaseIds: compatible ? cases.map(drillCaseId).filter(id => weakIds.includes(id)) : [], strategy: weakOnly ? "weighted" : drill.strategy } }));
  }

  catalogueContextChanged(): void {
    if (this.state.get().drill.status === "summary") return; // Captured run context remains authoritative.
    this.reset();
    this.state.update(s => ({ ...s, drill: { ...s.drill, selectedCaseIds: [] } }));
  }

  physicalStateChanged(): void {
    if (this.state.get().mode === "setup" && this.#model) {
      this.state.update((state) => ({ ...state, displayFacelets: this.#model!.facelets }));
    }
    this.reconcilePhysicalState();
  }

  leave(): void {
    if (this.state.get().activity === "drill") { this.reset("virtual"); return; }
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
    this.setTrainingActivity("single");
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
    this.state.update((s) => ({ ...s, family, drill: { ...s.drill, selectedCaseIds: [] }, phase: "selecting", target: null, setup: "", setupProgress: null, recovery: null, liveMoves: [], result: null }));
  }

  async selectLastLayerCase(family: LastLayerFamily, caseId: string, catalogue?: LastLayerTrainingSet): Promise<void> {
    const settings = this.#dependencies.getSettings();
    // Historical case tables name Full cases, independently of the user's library
    // preference. Explicit catalogue navigation still uses the same lifecycle.
    const trainingSet = catalogue ?? (family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
    if (!lastLayerCaseIds(family, trainingSet).includes(caseId)) return;
    this.setTrainingActivity("single");
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

  randomTrainingCase(family: TrainingFamily): void {
    if (family === "f2l") {
      const cases = f2lTrainingCatalogue(this.state.get().f2lSelection.library).cases;
      const selected = cases[this.#draw(cases.length)];
      if (selected) void this.selectF2lCase(selected.name);
      return;
    }
    const settings = this.#dependencies.getSettings();
    const cases = lastLayerCaseIds(family, family === "oll" ? settings.ollTrainingSet : settings.pllTrainingSet);
    const caseId = cases[this.#draw(cases.length)];
    if (caseId) void this.selectLastLayerCase(family, caseId);
  }

  #buildRandomLastLayerCatalogueTarget(
    family: LastLayerFamily,
    caseId: string,
    trainingSet: LastLayerTrainingSet,
  ): LastLayerTrainingTarget {
    const kpuzzle = this.#model!.kpuzzle;
    const variants = lastLayerTrainingVariants(kpuzzle, family, caseId, trainingSet);
    const variation = this.#variation(trainingCatalogueKey({ family, caseId, trainingSet }), variants.length);
    return buildLastLayerCatalogueTarget(kpuzzle, family, caseId, variation.auf, trainingSet, variants[variation.variant].id);
  }

  async selectF2lPosition(position: F2lPosition): Promise<void> {
    if (this.state.get().drill.status !== "configuring") return;
    if (this.state.get().target?.origin.kind === "solve-step") return;
    this.state.update((s) => ({ ...s, family: "f2l", f2lSelection: { ...s.f2lSelection, position } }));
    if (this.state.get().activity === "drill" || !this.#f2lCase || !this.#model) return;
    await this.#prepareTarget(this.#buildF2lCatalogueTarget(this.#f2lCase, position));
  }

  setF2lLibrary(selectedLibrary: F2lTrainingLibrary): void {
    if (this.state.get().drill.status !== "configuring") return;
    this.setTrainingFamily("f2l");
    if (this.state.get().f2lSelection.library === selectedLibrary) return;
    this.catalogueContextChanged();
    this.state.update((s) => ({ ...s, family: "f2l", f2lSelection: { ...s.f2lSelection, library: selectedLibrary } }));
  }

  async practiceSolveStep(solve: Solve, step: SolveStep): Promise<void> {
    this.setTrainingActivity("single");
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
    if (this.state.get().activity === "drill") return;
    const training = this.state.get();
    if (training.mode === mode) return;
    if (training.family === "f2l") {
      await this.#setF2lMode(mode);
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
    if (this.state.get().activity === "drill") return;
    if (this.state.get().family === "f2l") void this.#reloadF2lTraining();
    else void this.#reloadLastLayerTraining();
  }

  resetTraining(): void {
    this.reset();
    this.#trainingTarget = null;
  }

  async #setF2lMode(mode: TrainingMode): Promise<void> {
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

  reset(mode: TrainingMode = this.state.get().mode): void {
    const current = this.state.get();
    this.#drillCountdownUntil = null;
    this.#caseRevealedAt = null;
    this.drillCountdown.set(null);
    const selectedPosition = current.f2lSelection.position;
    const selectedCaseIds = current.drill.status === "summary" && current.drill.context &&
      JSON.stringify(current.drill.context) !== JSON.stringify(this.#drillContext()) ? [] : current.drill.selectedCaseIds;
    this.#trainingSelectionToken++;
    this.#recoveryToken++;
    this.#f2lCase = null;
    this.#trainingTarget = null;
    this.#trainingGuide = null;
    this.#preferredReference = null;
    this.#trainingTracker = null;
    this.#trainingRawMoves = [];
    this.#trainingVirtualPattern = null;
    this.#f2lAgainTurns = [];
    this.#dependencies.stopClock();
    this.#dependencies.elapsed.set(0);
    this.state.update((s) => ({ ...emptyTrainingState(), activity: s.activity, drill: { ...s.drill, selectedCaseIds, running: false, status: "configuring", outcomes: [], round: 0, runId: null, context: null, lastCaseId: null, lastOutcome: null }, family: s.family, mode, f2lSelection: { position: selectedPosition, library: s.f2lSelection.library } }));
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
    const variation = this.#variation(trainingCatalogueKey({ family: "f2l", library: f2lCase.library, caseName: f2lCase.name, position }));
    return buildF2lCatalogueTarget(this.#model.kpuzzle, f2lCase, position, base, variation.auf);
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

  #resolvePreferredReference(target: TrainingTarget): TrainingResolvedReference | null {
    const identity = catalogueIdentityForTarget(target.info);
    if (!identity) return null;
    const preference = this.#dependencies.getTrainingAlgorithmPreference?.(trainingCatalogueKey(identity));
    if (!preference) return null;
    return isLastLayerTarget(target)
      ? resolveLastLayerTrainingReference(target, preference.algorithm)
      : resolveF2lTrainingReference(target, preference.algorithm);
  }

  #buildEffectiveGuide(target: TrainingTarget): TrainingGuide | null {
    return buildTrainingGuide(target.pattern, { ...target.info,
      references: this.#preferredReference ? [this.#preferredReference] : target.info.references });
  }

  /** Refresh reference facts only: the target/setup/pattern/result/lifecycle stay intact. */
  refreshPreferredAlgorithm(): boolean {
    const state = this.state.get(), target = this.#trainingTarget;
    if (!target || state.phase === "solving") return false;
    this.#preferredReference = this.#resolvePreferredReference(target);
    if (state.activity === "single") this.#trainingGuide = this.#buildEffectiveGuide(target);
    const guide = this.#trainingGuide;
    const pattern = state.mode === "virtual" ? this.#trainingVirtualPattern : this.#model?.pattern;
    const progress = guide ? (state.phase === "ready" && pattern
      ? advanceTrainingGuide(guide, pattern, 0) : trainingGuideProgress(guide)) : null;
    this.state.update(s => ({ ...s,
      preferredReference: this.#preferredReference ? { alg: this.#preferredReference.alg, stm: this.#preferredReference.stm } : null,
      guide: state.activity === "single" ? progress : s.guide,
    }));
    return true;
  }

  async #prepareTarget(
    target: TrainingTarget,
    preserveResult = false,
    recognition: TrainingState["recognition"] = null,
  ): Promise<void> {
    const model = this.#model;
    if (!model) return;
    const token = ++this.#trainingSelectionToken;
    this.#recoveryToken++;
    if (!this.state.get().drill.running) this.#dependencies.stopClock();
    const mode = this.state.get().mode;
    const captured = model.pattern;
    const capturedFacelets = patternToFacelets(captured);
    const targetFacelets = patternToFacelets(target.pattern);
    this.#trainingTarget = target;
    this.#preferredReference = this.#resolvePreferredReference(target);
    this.#trainingGuide = this.#buildEffectiveGuide(target);
    this.#trainingTracker = null;
    this.#trainingRawMoves = [];
    this.#f2lAgainTurns = [];
    this.#trainingVirtualPattern = mode === "virtual" ? target.pattern : null;
    this.#dependencies.elapsed.set(0);
    // Target/reference preparation is complete; timing starts at case publication.
    if (this.state.get().drill.running) this.#caseRevealedAt = this.#now();
    this.state.update((s) => ({
      ...s,
      family: target.info.family,
      mode,
      f2lSelection: target.info.family === "f2l"
        ? { ...s.f2lSelection, position: target.info.position } : s.f2lSelection,
      phase: mode === "virtual" ? "ready" : "preparing",
      target: target.info,
      preferredReference: this.#preferredReference ? { alg: this.#preferredReference.alg, stm: this.#preferredReference.stm } : null,
      setup: "",
      setupProgress: null,
      recovery: null,
      recoveryPending: false,
      liveMoves: [],
      guide: !recognition && this.#trainingGuide ? trainingGuideProgress(this.#trainingGuide) : null,
      result: preserveResult ? s.result : null,
      recognition,
      displayFacelets: mode === "virtual" || !this.hasCube ? targetFacelets : capturedFacelets,
      displayRevision: s.displayRevision + 1,
    }));

    if (mode === "virtual") return;

    try {
      const grip = trainingGrip(target.info);
      const direct = this.#directF2lSetup(target, captured, model);
      let tracker = capturedFacelets === targetFacelets ? new ScrambleTracker(model.kpuzzle, "", captured) : direct?.tracker ?? null;
      let displayedSetup = capturedFacelets === targetFacelets ? "" : direct?.setup ?? null;

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
    const setup = f2lCatalogueSetupMoves(this.#f2lCase, target.info.position, target.info.auf ?? 0);
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
    if (!target || training.activity === "drill" && training.drill.task === "recognition") return;
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
      this.#trainingStartedAt = this.#now();
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
      if (guide.confirmed !== training.guide?.confirmed) {
        this.state.update((s) => ({ ...s, guide }));
      }
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
    if (this.state.get().phase !== "solving") return;
    const { mode, activity, drill } = this.state.get();
    const completedAt = this.#now();
    const caseTimeMs = activity === "drill" && this.#caseRevealedAt !== null ? Math.max(0, completedAt - this.#caseRevealedAt) : null;
    this.#dependencies.stopClock();
    const offsets = fitMoveTimestamps(this.#trainingRawMoves);
    const timed: TimedMove[] = this.#trainingRawMoves.map((move, index) => ({
      move: move.move,
      t: offsets[index] ?? 0,
    }));
    const target = this.#trainingTarget;
    const handTimed = target ? handTimedMoves(timed, this.#trainingGrip(target)) : timed;
    const efficiency = calculateTrainingEfficiency(handTimed, target?.info.references,
      target ? { pattern: target.pattern, trainingRotation: target.info.trainingRotation } : undefined, this.#preferredReference);
    this.#dependencies.elapsed.set(efficiency.elapsedMs);
    const result: TrainingResult = {
      moves: efficiency.moves.map(({ move }) => move),
      stm: efficiency.stm,
      elapsedMs: efficiency.elapsedMs,
      caseTimeMs,
      recommendedStm: efficiency.recommendedStm,
      recommendedAlg: target?.info.references[0]?.alg ?? null,
      matchedReferenceRank: efficiency.matchedReferenceRank,
      delta: efficiency.delta,
      preferredAlg: this.#preferredReference?.alg ?? null,
      preferredStm: efficiency.preferredStm, matchedPreferred: efficiency.matchedPreferred, preferredDelta: efficiency.preferredDelta,
    };
    this.state.update((s) => ({
      ...s, phase: "result", result,
      drill: activity === "drill" ? { ...s.drill, lastOutcome: "solved", outcomes: [...s.drill.outcomes,
        { caseId: s.drill.lastCaseId!, outcome: "solved", caseTimeMs: caseTimeMs!, moveSpanMs: result.elapsedMs,
          stm: result.stm, delta: result.preferredDelta ?? result.delta, completedAt }] } : s.drill,
      guide: s.guide ? { ...s.guide, currentMove: null } : null
    }));
    if (target) this.#dependencies.onAttemptCompleted?.({ activity, mode, target: target.info, result,
      drillRunId: activity === "drill" ? drill.runId : null, drillRound: activity === "drill" ? drill.round : null });
    if (activity === "drill" && this.state.get().drill.running) {
      this.#beginDrillCountdown();
    } else if (this.state.get().mode === "virtual") {
      if (target && isLastLayerTarget(target)) void this.#reloadLastLayerTraining(true);
      else void this.#reloadF2lTraining(true);
    }
  }

}
