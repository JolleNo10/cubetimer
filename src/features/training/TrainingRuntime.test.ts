import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SolveStep } from "../../cube/analysis";
import { F2L_POSITIONS } from "../../cube/f2lCases";
import type { F2lTrainingTargetInfo } from "../../cube/f2lTraining";
import {
  buildF2lCatalogueTarget,
  f2lCubeAlgorithm,
  f2lTrainingGrip,
  isStandardF2lBase,
  referenceExecutionSignature,
} from "../../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES, findF2lTrainingCase } from "../../cube/f2lTrainingCases";
import { buildLastLayerCatalogueTarget, lastLayerCaseIds, lastLayerTrainingVariants } from "../../cube/lastLayerTraining";
import { CubeModel, patternToFacelets } from "../../cube/model";
import { get3x3x3 } from "../../cube/puzzle";
import { lastLayerCornersPermuted, lastLayerEdges, reframe, withCentresHome } from "../../cube/recognise";
import * as solver from "../../cube/solver";
import { cubeMove, handAlgorithm } from "../../cube/frames";
import * as trainingDomain from "../../cube/training";
import { trainingGrip } from "../../cube/training";
import * as db from "../../infrastructure/persistence/db";
import { Store } from "../../shared/store";
import { TrainingRuntime, type CompletedTrainingAttempt, type TrainingDependencies } from "./TrainingRuntime";
import type { Solve } from "../../app/types";
import { DEFAULT_SETTINGS, type Settings } from "../../app/types";


const kpuzzle = await get3x3x3();
const runtimeRandom = vi.fn<() => number>().mockReturnValue(0);
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
afterEach(() => { vi.restoreAllMocks(); runtimeRandom.mockReset().mockReturnValue(0); globalThis.requestAnimationFrame = originalRequestAnimationFrame; globalThis.cancelAnimationFrame = originalCancelAnimationFrame; });
function stubTimerLoop() { globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => { }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(fulfil => { resolve = fulfil; }); return { promise, resolve }; }
type Inputs = { model: CubeModel; settings: Settings; virtualCube: boolean; error: string | null };
const fixtures = new WeakMap<TrainingRuntime, Inputs>();
function inputs(runtime: TrainingRuntime): Inputs { return fixtures.get(runtime)!; }
function configureInputs(runtime: TrainingRuntime, update: (input: Inputs) => Inputs): void { fixtures.set(runtime, update(inputs(runtime))); }
function createRuntime(model: CubeModel, onAttemptCompleted?: (attempt: CompletedTrainingAttempt) => void, dependencies: Partial<TrainingDependencies> = {}): TrainingRuntime {
  const runtime: TrainingRuntime = new TrainingRuntime({
    getModel: () => inputs(runtime).model, getSettings: () => inputs(runtime).settings,
    hasCube: () => inputs(runtime).virtualCube, isActive: () => true, elapsed: new Store(0), startClock: vi.fn(), stopClock: vi.fn(),
    onAttemptCompleted, rng: runtimeRandom,
    reportError: error => { inputs(runtime).error = error; }, ...dependencies
  });
  fixtures.set(runtime, { model, settings: DEFAULT_SETTINGS, virtualCube: false, error: null });
  return runtime;
}
function feedMove(runtime: TrainingRuntime, token: string): void {
  inputs(runtime).model.applyMove(token);
  const timestamp = performance.now();
  runtime.handleMove({ serial: 0, face: 0, direction: 0, move: token, localTimestamp: timestamp, cubeTimestamp: timestamp });
  runtime.physicalStateChanged();
}
function solveFor(sessionId: string): Solve {
  return { id: "historical", sessionId, createdAt: 0, rawMs: 1000, penalty: "none", scramble: "", source: "keyboard", moves: [] };
}
function f2lTargetOf(runtime: TrainingRuntime): F2lTrainingTargetInfo | null { const target = runtime.state.get().target; return target?.family === "f2l" ? target : null; }
describe("TrainingRuntime shared algorithm guide", () => {
  it.each([
    ["oll", "Sune", "R"],
    ["oll", "T", "r"],
    ["oll", "L-Shape", "f"],
    ["pll", "H", "M"],
  ] as const)("classifies the recommended 2-Look %s %s execution containing %s", async (family, caseId, vocabulary) => {
    stubTimerLoop();
    const built = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, "2look");
    const setup = await solver.algBetween(kpuzzle.defaultPattern(), built.pattern);
    vi.spyOn(solver, "algBetween").mockResolvedValue(setup);
    runtimeRandom.mockReturnValue(0);
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({
      ...state, virtualCube: true,
      settings: { ...state.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" }
    }));
    runtime.setTrainingFamily(family);
    await runtime.selectLastLayerCase(family, caseId);
    const target = runtime.state.get().target!;
    for (const move of runtime.state.get().setup.split(" ").filter(Boolean)) {
      feedMove(runtime, cubeMove(move, trainingGrip(target)));
    }
    expect(runtime.state.get().phase).toBe("ready");
    expect(target.references[0].alg).toContain(vocabulary);
    // M2 is reported as opposing face turns; either face may arrive first.
    const execution = caseId === "H" ? "L R L R D L R L R U2 L R L R D L R L R".split(" ")
      : referenceExecutionSignature(target.references[0].alg)!;
    for (const move of execution) feedMove(runtime, cubeMove(move, trainingGrip(target)));
    expect(runtime.state.get().result).toMatchObject({
      matchedReferenceRank: 1, stm: target.references[0].stm, delta: 0,
    });
    expect(runtime.state.get().phase).toBe("result");

  });

  it("classifies a validated F2L alternative while keeping a rejoining execution custom", async () => {
    stubTimerLoop();
    runtimeRandom.mockReturnValue(0);
    const runtime = createRuntime(new CubeModel(kpuzzle));
    await runtime.setTrainingMode("virtual");
    await runtime.selectF2lCase("F2L 1");
    const target = runtime.state.get().target!;
    const alternative = target.references[1];
    expect(alternative.rank).toBe(2);
    const execution = referenceExecutionSignature(alternative.alg)!;
    for (const move of execution) feedMove(runtime, cubeMove(move, trainingGrip(target)));
    expect(runtime.state.get().result?.matchedReferenceRank).toBe(2);
    runtime.againTraining();
    await Promise.resolve();
    const recommendation = referenceExecutionSignature(runtime.state.get().target!.references[0].alg)!;
    const detour = [...recommendation.slice(0, 1), "B", "B'", ...recommendation.slice(1)];
    for (const move of detour) feedMove(runtime, cubeMove(move, trainingGrip(target)));
    expect(runtime.state.get().result?.matchedReferenceRank).toBeNull();
  });

  async function select(family: "f2l" | "oll" | "pll", mode: "setup" | "virtual") {
    stubTimerLoop();
    if (mode === "setup" && family !== "f2l") {
      // Search uses randomness too; calculate a real setup before fixing the
      // catalogue AUF draw, as in the existing physical Training fixtures.
      const built = buildLastLayerCatalogueTarget(kpuzzle, family, family === "oll" ? "27" : "T");
      const setup = await solver.algBetween(kpuzzle.defaultPattern(), built.pattern);
      vi.spyOn(solver, "algBetween").mockResolvedValue(setup);
    }
    runtimeRandom.mockReturnValue(0);
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));
    runtime.setTrainingFamily(family);
    await runtime.setTrainingMode(mode);
    if (family === "f2l") await runtime.selectF2lCase("F2L 1");
    else await runtime.selectLastLayerCase(family, family === "oll" ? "27" : "T");
    expect(inputs(runtime).error).toBeNull();
    const target = runtime.state.get().target!;
    if (mode === "setup") {
      for (const move of runtime.state.get().setup.split(" ").filter(Boolean)) {
        feedMove(runtime, cubeMove(move, trainingGrip(target)));
      }
    }
    expect(runtime.state.get().phase).toBe("ready");
    return runtime;
  }

  it.each(["f2l", "oll", "pll"] as const)("uses actual %s patterns in both modes, allows deviations, and completes custom solutions", async (family) => {
    for (const mode of ["setup", "virtual"] as const) {
      const runtime = await select(family, mode);
      const ready = runtime.state.get();
      const target = ready.target!;
      const grip = trainingGrip(target);
      expect(ready.guide).toMatchObject({ confirmed: 0, currentMove: { token: ready.guide!.moves[0] } });
      const physicalStart = inputs(runtime).model.pattern;
      const reference = referenceExecutionSignature(target.references[0].alg)!;
      // Six repetitions are a state identity but a different execution. The
      // reference guide must remain advisory during this deliberate detour.
      const detour = Array.from(new Alg("(F U F' U')6").expand().childAlgNodes()).map((node) => node.toString());
      feedMove(runtime, cubeMove(detour[0], grip));
      expect(runtime.state.get().phase).toBe("solving");
      expect(runtime.state.get().target).toBe(target);
      expect(runtime.state.get().result).toBeNull();
      expect(runtime.state.get().guide?.confirmed).toBe(0);
      for (const move of detour.slice(1)) feedMove(runtime, cubeMove(move, grip));
      expect(runtime.state.get().result).toBeNull();
      feedMove(runtime, cubeMove(reference[0], grip));
      expect(runtime.state.get().guide?.confirmed).toBe(1);
      for (const move of reference.slice(1)) feedMove(runtime, cubeMove(move, grip));
      const result = runtime.state.get().result;
      expect(result).not.toBeNull();
    expect(result?.caseTimeMs).toBeNull();
      expect(result?.matchedReferenceRank).toBeNull();

      if (mode === "setup") {
        expect(runtime.state.get().phase).toBe("result");
        expect(runtime.state.get().guide?.currentMove).toBeNull();
      } else {
        // Existing virtual automatic reload preserves the result for review.
        expect(runtime.state.get().phase).toBe("ready");
        expect(runtime.state.get().guide?.confirmed).toBe(0);
        expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(patternToFacelets(physicalStart.applyAlg(
          [...detour, ...reference].map((move) => cubeMove(move, grip)).join(" "))));
      }
      runtime.againTraining();
      await Promise.resolve();
      expect(runtime.state.get().guide?.confirmed).toBe(0);
      expect(runtime.state.get().guide?.currentMove?.token).toBe(runtime.state.get().guide?.moves[0]);
      expect(runtime.state.get().result).toBeNull();
    }
  });

  it("resets progression on another target, family, mode, and Training reset", async () => {
    const runtime = await select("f2l", "virtual");
    const target = runtime.state.get().target!;
    feedMove(runtime, cubeMove(runtime.state.get().guide!.moves[0], trainingGrip(target)));
    expect(runtime.state.get().guide?.confirmed).toBe(1);
    await runtime.selectF2lCase("F2L 4");
    expect(runtime.state.get().guide?.confirmed).toBe(0);
    feedMove(runtime, cubeMove(runtime.state.get().guide!.moves[0], trainingGrip(runtime.state.get().target!)));
    await runtime.setTrainingMode("setup");
    expect(runtime.state.get().guide?.confirmed).toBe(0);
    runtime.setTrainingFamily("oll");
    expect(runtime.state.get().guide).toBeNull();
    await runtime.setTrainingMode("virtual");
    await runtime.selectLastLayerCase("oll", "27");
    expect(runtime.state.get().guide?.confirmed).toBe(0);
    runtime.resetTraining();
    expect(runtime.state.get().guide).toBeNull();
  });

  it("omits guidance for an exact F2L target without a validated reference", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    await runtime.setTrainingMode("virtual");
    const slot = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]).info.slot;
    await runtime.practiceSolveStep({
      id: "no-reference", scramble: "R", moves: [{ move: "R'", t: 1 }],
      analysis: { crossFace: "U" }
    } as Solve,
      { name: "F2L Slot 1", slot, fromMove: 0, toMove: 1, skipped: false } as SolveStep);
    expect(runtime.state.get().target?.references).toEqual([]);
    expect(runtime.state.get().guide).toBeNull();
  });
});
describe("TrainingRuntime last-layer sets", () => {
  it("preserves the completed Headlights recommendation when virtual reload selects a different variant", async () => {
    stubTimerLoop();
    const saveSolve = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const variants = lastLayerTrainingVariants(kpuzzle, "pll", "Headlights", "2look");
    const targets = variants.map((variant) => buildLastLayerCatalogueTarget(kpuzzle, "pll", "Headlights", 0, "2look", variant.id));
    const first = targets[0];
    const nextIndex = targets.findIndex((target) => target.info.references[0].alg !== first.info.references[0].alg);
    expect(nextIndex).toBeGreaterThan(0);
    const next = targets[nextIndex];
    const completed = vi.fn();
    const runtime = createRuntime(new CubeModel(kpuzzle), completed);
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true, settings: { ...state.settings, pllTrainingSet: "2look" } }));
    runtime.setTrainingFamily("pll");
    await runtime.setTrainingMode("virtual");
    const random = runtimeRandom
      .mockReturnValueOnce(0.5 / variants.length).mockReturnValueOnce(0)
      .mockReturnValueOnce((nextIndex + 0.5) / variants.length).mockReturnValueOnce(0);
    await runtime.selectLastLayerCase("pll", "Headlights");
    expect(runtime.state.get().target?.references[0]).toEqual(first.info.references[0]);
    const execution = referenceExecutionSignature(first.info.references[0].alg)!;
    for (const move of execution) feedMove(runtime, cubeMove(move, trainingGrip(first.info)));
    const training = runtime.state.get();
    expect(training.phase).toBe("ready");
    expect(training.result).toMatchObject({
      recommendedAlg: first.info.references[0].alg, recommendedStm: first.info.references[0].stm,
      matchedReferenceRank: 1, delta: 0,
    });
    expect(training.target?.references[0]).toEqual(next.info.references[0]);
    expect(training.target).toMatchObject({ family: "pll", caseId: "Headlights", trainingSet: "2look" });
    expect(training.displayFacelets).toBe(patternToFacelets(next.pattern));
    expect(training.displayFacelets).not.toBe(patternToFacelets(first.pattern));
    expect(random).toHaveBeenCalledTimes(4);
    expect(completed).toHaveBeenCalledExactlyOnceWith({ activity: "single", drillRunId: null, drillRound: null, mode: "virtual", target: first.info, result: training.result });

    expect(saveSolve).not.toHaveBeenCalled();
    const nextMove = referenceExecutionSignature(next.info.references[0].alg)![0];
    feedMove(runtime, cubeMove(nextMove, trainingGrip(next.info)));
    expect(runtime.state.get().result).toBeNull();
    expect(runtime.state.get().target?.references[0]).toEqual(next.info.references[0]);
  });
  it.each([
    ["oll", "Dot Shape", "orient-edges"],
    ["oll", "I-Shape", "orient-edges"],
    ["oll", "L-Shape", "orient-edges"],
    ["pll", "Diagonal", "permute-corners"],
    ["pll", "Headlights", "permute-corners"],
  ] as const)("randomizes %s %s on selection, Again, and virtual completion", async (family, caseId, completionGoal) => {
    stubTimerLoop();
    const saveSolve = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const model = new CubeModel(kpuzzle);
    const physicalFacelets = patternToFacelets(model.pattern);
    const runtime = createRuntime(model);
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true, settings: { ...state.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" } }));
    runtime.setTrainingFamily(family);
    await runtime.setTrainingMode("virtual");
    const variants = lastLayerTrainingVariants(kpuzzle, family, caseId, "2look");
    const random = runtimeRandom;
    // A separate fixed AUF draw proves facelet variation comes from Full cases.
    for (let index = 0;index < variants.length;index++) {
      random.mockReturnValueOnce((index + 0.5) / variants.length).mockReturnValueOnce(0.25);
      await runtime.selectLastLayerCase(family, caseId);
      const expected = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 1, "2look", variants[index].id);
      expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(expected.pattern));
      expect(runtime.state.get().target).toMatchObject({ family, caseId, trainingSet: "2look", completionGoal, auf: 1 });
    }
    expect(random).toHaveBeenCalledTimes(variants.length * 2);
    expect(patternToFacelets(model.pattern)).toBe(physicalFacelets);
    const previous = runtime.state.get().displayFacelets;
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.25);
    runtime.againTraining();
    const ready = runtime.state.get();
    expect(ready.displayFacelets).not.toBe(previous);
    expect(ready.target).toMatchObject({ caseId, trainingSet: "2look", completionGoal, auf: 1 });
    const target = ready.target;
    if (!target || target.family === "f2l") throw new Error("Last-layer target missing");
    random.mockReturnValueOnce(0.999).mockReturnValueOnce(0.25);
    const execution = referenceExecutionSignature(target.references[0].alg)!;
    const rawMoves = execution.map((move) => cubeMove(move, trainingGrip(target)));
    for (const move of rawMoves) feedMove(runtime, move);
    expect(runtime.state.get().phase).toBe("ready");
    expect(runtime.state.get().result).not.toBeNull();
    expect(runtime.state.get().displayFacelets).toBe(previous);
    expect(runtime.state.get().target).toMatchObject({ caseId, trainingSet: "2look", completionGoal, auf: 1 });
    expect(random).toHaveBeenCalledTimes(variants.length * 2 + 4);
    expect(patternToFacelets(model.pattern)).toBe(patternToFacelets(kpuzzle.defaultPattern().applyAlg(new Alg(rawMoves.join(" ")))));

    expect(saveSolve).not.toHaveBeenCalled();
  });
  it.each([
    ["oll", "27", "full"], ["pll", "T", "full"],
    ["oll", "Sune", "2look"], ["pll", "Ua", "2look"],
  ] as const)("keeps %s %s in %s deterministic apart from AUF", async (family, caseId, trainingSet) => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    runtime.setTrainingFamily(family);
    await runtime.setTrainingMode("virtual");
    const random = runtimeRandom.mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    await runtime.selectLastLayerCase(family, caseId, trainingSet);
    expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 1, trainingSet).pattern));
    runtime.againTraining();
    expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 3, trainingSet).pattern));
    expect(random).toHaveBeenCalledTimes(2);
  });
  it.each([["oll", "I-Shape"], ["pll", "Headlights"]] as const)("uses the same randomized %s %s target in physical and virtual modes", async (family, caseId) => {
    const variants = lastLayerTrainingVariants(kpuzzle, family, caseId, "2look");
    const index = variants.length - 1;
    const variant = variants[index];
    const expected = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 2, "2look", variant.id);
    const setup = (await solver.algBetween(kpuzzle.defaultPattern(), expected.pattern)).toString();
    const between = vi.spyOn(solver, "algBetween").mockResolvedValue(new Alg(setup));
    const model = new CubeModel(kpuzzle);
    const runtime = createRuntime(model);
    configureInputs(runtime, (state) => ({ ...state, settings: { ...state.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" } }));
    const random = runtimeRandom.mockReturnValueOnce((index + 0.5) / variants.length).mockReturnValueOnce(0.5);
    await runtime.selectLastLayerCase(family, caseId);
    expect(patternToFacelets(between.mock.calls[0][1])).toBe(patternToFacelets(expected.pattern));
    expect(patternToFacelets(model.pattern.applyAlg(new Alg(setup)))).toBe(patternToFacelets(expected.pattern));
    expect(runtime.state.get().setup).toBe(handAlgorithm(setup, trainingGrip(expected.info)));
    await runtime.setTrainingMode("virtual");
    expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(expected.pattern));
    expect(runtime.state.get().target).toMatchObject({ caseId, trainingSet: "2look", auf: 2 });
    expect(random).toHaveBeenCalledTimes(2);
    expect(patternToFacelets(model.pattern)).toBe(patternToFacelets(kpuzzle.defaultPattern()));
  });
  it("loads Full historical case catalogue navigation without changing saved 2-Look preferences", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({ ...state, settings: { ...state.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" } }));
    await runtime.setTrainingMode("virtual");
    await runtime.selectLastLayerCase("oll", "27", "full");
    expect(runtime.state.get().target).toMatchObject({ family: "oll", trainingSet: "full", caseId: "27", origin: { kind: "catalog" } });
    expect(inputs(runtime).settings.ollTrainingSet).toBe("2look");
    runtime.againTraining();
    expect(runtime.state.get().target).toMatchObject({ trainingSet: "full", caseId: "27" });

  });
  it.each([
    ["oll", "I-Shape", "orient-edges", "virtual"],
    ["oll", "I-Shape", "orient-edges", "setup"],
    ["oll", "Sune", "orient-last-layer", "virtual"],
    ["pll", "Headlights", "permute-corners", "virtual"],
    ["pll", "Headlights", "permute-corners", "setup"],
    ["pll", "Ua", "solve-cube", "virtual"],
  ] as const)("completes 2-Look %s %s at %s in %s mode without Solve history", async (family, caseId, goal, mode) => {
    stubTimerLoop();
    runtimeRandom.mockReturnValue(0);
    const saveSolve = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const built = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, "2look");
    const rawSetup = mode === "setup" ? (await solver.algBetween(kpuzzle.defaultPattern(), built.pattern)).toString() : "";
    if (mode === "setup") vi.spyOn(solver, "algBetween").mockResolvedValue(new Alg(rawSetup));
    const model = new CubeModel(kpuzzle);
    const runtime = createRuntime(model);
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));
    runtime.setTrainingFamily(family);
    configureInputs(runtime, input => ({ ...input, settings: { ...input.settings, [family === "oll" ? "ollTrainingSet" : "pllTrainingSet"]: "2look" } }));
    await runtime.setTrainingMode(mode);
    await runtime.selectLastLayerCase(family, caseId);
    if (mode === "setup") {
      expect(runtime.state.get().phase).toBe("preparing");
      for (const move of rawSetup.split(/\s+/)) feedMove(runtime, move);
      expect(patternToFacelets(model.pattern)).toBe(patternToFacelets(built.pattern));
    }
    const target = runtime.state.get().target;
    if (!target || target.family === "f2l") throw new Error("Last-layer target missing");
    expect(target).toMatchObject({ family, trainingSet: "2look", caseId, completionGoal: goal });
    expect(runtime.state.get().phase).toBe("ready");
    const rawMoves = Array.from(new Alg(target.references[0].alg).expand().childAlgNodes()).map((node) => cubeMove(node.toString(), trainingGrip(target)));
    for (const move of rawMoves) feedMove(runtime, move);
    expect(runtime.state.get().result).toMatchObject({ recommendedStm: target.references[0].stm, delta: 0, matchedReferenceRank: 1 });
    expect(runtime.state.get().phase).toBe(mode === "virtual" ? "ready" : "result");

    expect(saveSolve).not.toHaveBeenCalled();
    const after = withCentresHome(kpuzzle, reframe(kpuzzle, built.pattern.applyAlg(new Alg(rawMoves.join(" "))), new Alg(target.trainingRotation.tokens.join(" "))));
    if (goal === "orient-edges") {
      expect(lastLayerEdges(after)).toBe("cross");
    } else if (goal === "permute-corners") {
      expect(lastLayerCornersPermuted(after)).toBe(true);
    }
    if (mode === "virtual") {
      runtime.againTraining();
      expect(runtime.state.get().target).toMatchObject({ trainingSet: "2look", caseId, completionGoal: goal });
    }
  });
  it.each(["oll", "pll"] as const)("random %s enumerates only the selected catalogue", (family) => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    const select = vi.spyOn(runtime, "selectLastLayerCase").mockResolvedValue();
    const random = runtimeRandom;
    for (const trainingSet of ["full", "2look"] as const) {
      configureInputs(runtime, (state) => ({ ...state, settings: { ...state.settings, [family === "oll" ? "ollTrainingSet" : "pllTrainingSet"]: trainingSet } }));
      const cases = lastLayerCaseIds(family, trainingSet);
      expect(cases).toHaveLength(trainingSet === "full" ? family === "oll" ? 57 : 21 : family === "oll" ? 10 : 6);
      select.mockClear();
      for (let index = 0;index < cases.length;index++) {
        random.mockReturnValue((index + 0.5) / cases.length);
        runtime.randomTrainingCase(family);
      }
      expect(select.mock.calls).toEqual(cases.map((caseId) => [family, caseId]));
    }
  });
  it.each(["oll", "pll"] as const)("rejects Full-only case selection in the 2-Look %s catalogue", async (family) => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({ ...state, settings: { ...state.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" } }));
    await runtime.selectLastLayerCase(family, family === "oll" ? "1" : "T");
    expect(runtime.state.get().target).toBeNull();
  });
  it.each([["oll", "27", "OLL"], ["pll", "H", "PLL"]] as const)("retains exact historical Full %s semantics with 2-Look selected", async (family, caseId, name) => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    runtime.setTrainingFamily(family);
    await runtime.setTrainingMode("virtual");
    configureInputs(runtime, input => ({ ...input, settings: { ...input.settings, ollTrainingSet: "2look", pllTrainingSet: "2look" } }));
    const source = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 2);
    const solve = { ...solveFor("1"), scrambledFacelets: patternToFacelets(source.pattern), analysis: { crossFace: "U" } } as Solve;
    const step = { name, case: caseId, skipped: false, fromMove: 0, toMove: 1 } as SolveStep;
    await runtime.practiceSolveStep(solve, step);
    expect(runtime.state.get().target).toMatchObject({ trainingSet: "full", caseId, auf: 2, completionGoal: family === "oll" ? "orient-last-layer" : "solve-cube", origin: { kind: "solve-step", solveId: solve.id } });
    expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(source.pattern));
    runtime.againTraining();
    expect(runtime.state.get().target).toMatchObject({ trainingSet: "full", auf: 2 });
    expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(source.pattern));
  });
});
describe("TrainingRuntime F2L setup and retry", () => {
  it("keeps solve-step practice exact across mode changes and retries", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;

    const exact = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    const solve = {
      id: "solve-step-runtime",
      scramble: "",
      scrambledFacelets: patternToFacelets(exact.pattern),
      moves: [{ move: "U", t: 10 }],
      analysis: { crossFace: exact.info.crossFace },
    } as unknown as Solve;
    const step = {
      name: "F2L Slot 1",
      slot: exact.info.slot,
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));

    runtime.setF2lLibrary("advanced");
    await runtime.practiceSolveStep(solve, step);
    const setupTarget = runtime.state.get().target;

    expect(setupTarget?.origin).toMatchObject({
      kind: "solve-step",
      solveId: solve.id,
      slot: exact.info.slot,
    });
    await runtime.setTrainingMode("virtual");
    expect(runtime.state.get().target?.origin.kind).toBe("solve-step");
    expect(runtime.state.get().phase).toBe("ready");
    expect(runtime.state.get().displayFacelets).toBe(
      patternToFacelets(exact.pattern),
    );
    expect(runtime.state.get().f2lSelection.library).toBe("advanced");
    runtime.againTraining();
    await Promise.resolve();
    expect(runtime.state.get().target?.origin.kind).toBe("solve-step");
    expect(runtime.state.get().displayFacelets).toBe(
      patternToFacelets(exact.pattern),
    );
  });
  it("rebuilds standard setup from the current F2L-complete base", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));
    await runtime.selectF2lCase("F2L 4");

    expect(runtime.state.get().setup).toBe("R U' R'");
    const firstTarget = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[3]);
    const firstGrip = f2lTrainingGrip(firstTarget.info);
    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].setup, firstGrip).split(" ")) {
      feedMove(runtime, move);
    }
    expect(runtime.state.get().phase).toBe("ready");

    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].algorithms.FR[0], firstGrip).split(" ")) {
      feedMove(runtime, move);
    }
    expect(runtime.state.get().phase).toBe("result");
    expect(isStandardF2lBase(inputs(runtime).model.pattern)).toBe(true);

    const completedResult = runtime.state.get().result;
    feedMove(runtime, "D");
    feedMove(runtime, "D");
    feedMove(runtime, "D");
    expect(runtime.state.get().phase).toBe("result");
    expect(runtime.state.get().result).toEqual(completedResult);
    feedMove(runtime, "D");
    expect(runtime.state.get().phase).toBe("preparing");
    expect(runtime.state.get().result).toBeNull();
    expect(runtime.state.get().liveMoves).toEqual([]);

    const baseAfterAttempt = inputs(runtime).model.pattern;
    const expectedNextTarget = buildF2lCatalogueTarget(
      kpuzzle,
      BASIC_CASES[3],
      baseAfterAttempt,
    );
    runtime.againTraining();
    expect(runtime.state.get().setup).toBe("R U' R'");
    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].setup, firstGrip).split(" ")) {
      feedMove(runtime, move);
    }
    expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(
      patternToFacelets(expectedNextTarget.pattern),
    );

    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].algorithms.FR[0], firstGrip).split(" ")) {
      feedMove(runtime, move);
    }
    await runtime.selectF2lCase("F2L 3");
    expect(runtime.state.get().setup).toBe("F' U F");
  });
  it("keeps the selected standard position through mode changes and retry", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));
    await runtime.selectF2lCase("F2L 10");
    await runtime.selectF2lPosition("BL");

    expect(runtime.state.get().f2lSelection.position).toBe("BL");
    expect(f2lTargetOf(runtime)?.position).toBe("BL");
    expect(runtime.state.get().target?.origin.kind).toBe("catalog");
    const firstSetup = runtime.state.get().setup;
    expect(firstSetup).toBeTruthy();

    await runtime.setTrainingMode("virtual");
    expect(f2lTargetOf(runtime)?.position).toBe("BL");
    runtime.againTraining();
    await Promise.resolve();
    expect(f2lTargetOf(runtime)?.position).toBe("BL");
    await runtime.setTrainingMode("setup");
    expect(f2lTargetOf(runtime)?.position).toBe("BL");
    expect(runtime.state.get().setup).not.toBe(firstSetup);
    expect(f2lTargetOf(runtime)?.auf).toBe(1);
  });
  it("keeps the generic setup fallback for a non-F2L-complete start", async () => {
    const physicalStart = kpuzzle.defaultPattern().applyAlg(new Alg("R U F"));
    const runtime = createRuntime(new CubeModel(kpuzzle, physicalStart));
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));
    await runtime.selectF2lCase("F2L 4");

    const setup = runtime.state.get().setup;
    expect(setup.length).toBeGreaterThan(0);
    expect(runtime.state.get().phase).toBe("preparing");
  });
});
describe("TrainingRuntime Advanced F2L catalogue", () => {
  function runtimeAtBase(base = kpuzzle.defaultPattern()) {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;
    const runtime = createRuntime(new CubeModel(kpuzzle, base));
    configureInputs(runtime, (state) => ({ ...state, virtualCube: true }));
    return runtime;
  }

  it("defaults to Basic and clears catalogue selection without changing mode, slot or physical state", async () => {
    const runtime = runtimeAtBase();
    expect(runtime.state.get().f2lSelection.library).toBe("basic");
    await runtime.setTrainingMode("virtual");
    await runtime.selectF2lPosition("BL");
    await runtime.selectF2lCase("F2L 3");
    feedMove(runtime, "L");
    expect(runtime.state.get().liveMoves.length).toBeGreaterThan(0);
    const physical = patternToFacelets(inputs(runtime).model.pattern);
    runtime.setF2lLibrary("advanced");
    expect(runtime.state.get()).toMatchObject({
      f2lSelection: { library: "advanced", position: "BL" }, mode: "virtual", phase: "selecting", target: null,
      result: null, setup: "", setupProgress: null, recovery: null, recoveryPending: false, liveMoves: []
    });

    expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(physical);
    await runtime.selectF2lCase("F2L 3");
    expect(runtime.state.get().target).toBeNull();
    await runtime.selectF2lCase("AF2L 3");
    expect(runtime.state.get().target?.origin).toMatchObject({ kind: "catalog", library: "advanced", caseName: "AF2L 3" });
    runtime.setF2lLibrary("basic");
    expect(runtime.state.get()).toMatchObject({ f2lSelection: { library: "basic", position: "BL" }, mode: "virtual", target: null, phase: "selecting" });
    await runtime.selectF2lCase("AF2L 3");
    expect(runtime.state.get().target).toBeNull();
    expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(physical);
  });

  it("repositions the authoritative Advanced case and keeps it through retry/mode changes", async () => {
    const runtime = runtimeAtBase();
    runtime.setF2lLibrary("advanced");
    await runtime.setTrainingMode("virtual");
    await runtime.selectF2lCase("AF2L 3");
    for (const position of F2L_POSITIONS) {
      await runtime.selectF2lPosition(position);
      const expected = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase("advanced", "AF2L 3")!, position, undefined, f2lTargetOf(runtime)?.auf);
      expect(f2lTargetOf(runtime)?.position).toBe(position);
      expect(runtime.state.get().displayFacelets).toBe(patternToFacelets(expected.pattern));
    }
    runtime.againTraining();
    await Promise.resolve();
    expect(runtime.state.get().target?.origin).toMatchObject({ library: "advanced", caseName: "AF2L 3" });
    await runtime.setTrainingMode("setup");
    expect(runtime.state.get()).toMatchObject({ f2lSelection: { library: "advanced", position: "BR" }, mode: "setup", phase: "preparing" });
    await runtime.setTrainingMode("virtual");
    expect(runtime.state.get()).toMatchObject({ f2lSelection: { library: "advanced", position: "BR" }, phase: "ready" });
  });

  it("runs Advanced direct Setup, completion and Again on the ordinary path with a physical LL base", async () => {
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    const runtime = runtimeAtBase(base);
    runtime.setF2lLibrary("advanced");
    await runtime.selectF2lPosition("FL");
    await runtime.selectF2lCase("AF2L 3");
    const entry = findF2lTrainingCase("advanced", "AF2L 3")!;
    const expected = buildF2lCatalogueTarget(kpuzzle, entry, "FL", base);
    const training = runtime.state.get();
    expect(training.setup).toBe(referenceExecutionSignature(entry.setup)!.join(" "));
    for (const move of f2lCubeAlgorithm(training.setup, f2lTrainingGrip(expected.info)).split(" ")) feedMove(runtime, move);
    expect(runtime.state.get().phase).toBe("ready");
    expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(patternToFacelets(expected.pattern));
    const reference = expected.info.references.find((candidate) => referenceExecutionSignature(candidate.alg) !== null)!;
    const execution = referenceExecutionSignature(reference.alg)!;
    for (const move of f2lCubeAlgorithm(execution.join(" "), f2lTrainingGrip(expected.info)).split(" ")) feedMove(runtime, move);
    expect(runtime.state.get().phase).toBe("result");
    expect(runtime.state.get().result?.matchedReferenceRank).toBe(reference.rank);
    runtime.againTraining();
    await Promise.resolve();
    expect(runtime.state.get().target?.origin).toMatchObject({ library: "advanced", caseName: "AF2L 3" });
    expect(runtime.state.get().f2lSelection.position).toBe("FL");
    expect(runtime.state.get().result).toBeNull();
    runtime.setF2lLibrary("basic");
    expect(runtime.state.get()).toMatchObject({ mode: "setup", f2lSelection: { position: "FL" }, setup: "", target: null, setupProgress: null });
  });

  it("uses the existing generic Setup fallback for the exact authoritative slice case", async () => {
    const runtime = runtimeAtBase(kpuzzle.defaultPattern().applyAlg(new Alg("R U F")));
    runtime.setF2lLibrary("advanced");
    await runtime.selectF2lPosition("BR");
    await runtime.selectF2lCase("AF2L 1");
    const expected = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase("advanced", "AF2L 1")!, "BR");
    const training = runtime.state.get();
    expect(training.phase).toBe("preparing");
    expect(training.setup).toMatch(/^[URFDLB2' ]+$/);
    for (const move of f2lCubeAlgorithm(training.setup, f2lTrainingGrip(expected.info)).split(" ")) feedMove(runtime, move);
    expect(runtime.state.get().phase).toBe("ready");
    expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(patternToFacelets(expected.pattern));
  });

  it("automatically repeats Advanced virtual attempts and clears results on library changes", async () => {
    const runtime = runtimeAtBase();
    runtime.setF2lLibrary("advanced");
    await runtime.setTrainingMode("virtual");
    await runtime.selectF2lPosition("FL");
    await runtime.selectF2lCase("AF2L 3");
    const target = runtime.state.get().target!;
    const reference = target.references.find((candidate) => referenceExecutionSignature(candidate.alg) !== null)!;
    const execution = referenceExecutionSignature(reference.alg)!;
    for (const move of f2lCubeAlgorithm(execution.join(" "), f2lTrainingGrip(target)).split(" ")) feedMove(runtime, move);
    expect(runtime.state.get().phase).toBe("ready");
    expect(runtime.state.get().result?.matchedReferenceRank).toBe(reference.rank);
    runtime.setF2lLibrary("basic");
    expect(runtime.state.get()).toMatchObject({ phase: "selecting", mode: "virtual", f2lSelection: { position: "FL" }, result: null, target: null, liveMoves: [] });
  });

  it("cancels an in-flight Advanced setup when the library changes", async () => {
    const runtime = runtimeAtBase(kpuzzle.defaultPattern().applyAlg(new Alg("R U F")));
    runtime.setF2lLibrary("advanced");
    await runtime.selectF2lPosition("BR");
    const selecting = runtime.selectF2lCase("AF2L 25");
    expect(runtime.state.get().phase).toBe("preparing");
    const physical = patternToFacelets(inputs(runtime).model.pattern);
    runtime.setF2lLibrary("basic");
    await selecting;
    expect(runtime.state.get()).toMatchObject({ f2lSelection: { library: "basic", position: "BR" }, mode: "setup", target: null, phase: "selecting", setup: "", setupProgress: null, recovery: null, recoveryPending: false });
    expect(patternToFacelets(inputs(runtime).model.pattern)).toBe(physical);
  });
});
describe("TrainingRuntime async ownership", () => {
  it.each(["f2l", "oll", "pll"] as const)("gives every %s target an explicit family", async (family) => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    await runtime.setTrainingMode("virtual");
    if (family === "f2l") await runtime.selectF2lCase("F2L 1");
    else await runtime.selectLastLayerCase(family, family === "oll" ? "27" : "T");
    expect(runtime.state.get().target?.family).toBe(family);
  });

  it("uses direct catalogue setup without asking the solver on a standard F2L base", async () => {
    const between = vi.spyOn(solver, "algBetween");
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, input => ({ ...input, virtualCube: true }));
    await runtime.selectF2lCase("F2L 4");
    expect(runtime.state.get().setup).toBe("R U' R'");
    expect(between).not.toHaveBeenCalled();
  });

  it("drops target A preparation after target B is selected", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg("R"))));
    const pending = deferred<Alg>();
    vi.spyOn(solver, "algBetween").mockReturnValue(pending.promise);
    const first = runtime.selectF2lCase("F2L 1");
    await runtime.setTrainingMode("virtual");
    await runtime.selectLastLayerCase("oll", "27");
    const latest = runtime.state.get();
    pending.resolve(new Alg("R U"));
    await first;
    expect(runtime.state.get()).toBe(latest);
    expect(latest.target).toMatchObject({ family: "oll", caseId: "27" });
    expect(latest.phase).toBe("ready");
  });

  it.each(["f2l", "oll"] as const)("transforms every move of %s recovery into the Training frame", async (family) => {
    runtimeRandom.mockReturnValue(0);
    const built = family === "oll" ? buildLastLayerCatalogueTarget(kpuzzle, "oll", "27") : null;
    const setup = built ? await solver.algBetween(kpuzzle.defaultPattern(), built.pattern) : new Alg("");
    const between = vi.spyOn(solver, "algBetween").mockResolvedValue(setup);
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, input => ({ ...input, virtualCube: true }));
    if (family === "f2l") await runtime.selectF2lCase("F2L 1");
    else await runtime.selectLastLayerCase("oll", "27");
    const target = runtime.state.get().target!;
    const raw = "R U R'";
    between.mockResolvedValue(new Alg(raw));
    inputs(runtime).model.applyMove("R2");
    inputs(runtime).model.applyMove("F2");
    inputs(runtime).model.applyMove("L");
    runtime.reconcilePhysicalState();
    expect(runtime.state.get().setupProgress?.onTrack).toBe(false);
    await vi.waitFor(() => expect(runtime.state.get().recoveryPending).toBe(false));
    const expected = handAlgorithm(raw, trainingGrip(target));
    expect(expected).not.toBe(raw);
    expect(runtime.state.get().recovery?.alg).toBe(expected);
    expect(runtime.state.get().recovery?.alg.split(" ")).toHaveLength(3);
  });

  it.each(["reset", "family", "mode", "target"] as const)("discards pending recovery after %s", async (action) => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, input => ({ ...input, virtualCube: true }));
    await runtime.selectF2lCase("F2L 1");
    const pending = deferred<Alg>();
    vi.spyOn(solver, "algBetween").mockReturnValue(pending.promise);
    inputs(runtime).model.applyMove("B");
    runtime.reconcilePhysicalState();
    expect(runtime.state.get().recoveryPending).toBe(true);
    if (action === "reset") runtime.reset();
    else if (action === "family") runtime.setTrainingFamily("pll");
    else if (action === "mode") await runtime.setTrainingMode("virtual");
    else {
      await runtime.setTrainingMode("virtual");
      await runtime.selectF2lCase("F2L 4");
    }
    const after = runtime.state.get();
    pending.resolve(new Alg("R U R'"));
    await pending.promise;
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => expect(runtime.state.get().recoveryPending).toBe(false));
    expect(runtime.state.get()).toBe(after);
    expect(runtime.state.get().recovery).toBeNull();
  });

  it("clears recovery pending on solver failure", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    configureInputs(runtime, input => ({ ...input, virtualCube: true }));
    await runtime.selectF2lCase("F2L 1");
    vi.spyOn(solver, "algBetween").mockRejectedValue(new Error("no solution"));
    inputs(runtime).model.applyMove("B");
    runtime.reconcilePhysicalState();
    await vi.waitFor(() => expect(runtime.state.get().recoveryPending).toBe(false));
    expect(runtime.state.get().recovery).toBeNull();
  });

  it("owns the attempt timestamp and stops reporting elapsed after reset", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    await runtime.setTrainingMode("virtual");
    await runtime.selectF2lCase("F2L 1");
    expect(runtime.elapsedAt(1000)).toBeNull();
    vi.spyOn(performance, "now").mockReturnValue(1000);
    feedMove(runtime, "R");
    expect(runtime.elapsedAt(1250)).toBe(250);
    runtime.reset();
    expect(runtime.elapsedAt(1250)).toBeNull();
  });
});

describe("TrainingRuntime family reset", () => {
  it("clears attempts through F2L, OLL, PLL and back while remembering F2L selection", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    runtime.setF2lLibrary("advanced");
    await runtime.selectF2lPosition("BL");
    await runtime.setTrainingMode("virtual");
    for (const [family, next] of [["f2l", "oll"], ["oll", "pll"], ["pll", "f2l"]] as const) {
      expect(runtime.state.get().family).toBe(family);
      if (family === "f2l") await runtime.selectF2lCase("AF2L 3");
      else await runtime.selectLastLayerCase(family, family === "oll" ? "27" : "T");
      feedMove(runtime, "B");
      expect(runtime.state.get().phase).toBe("solving");
      runtime.setTrainingFamily(next);
      expect(runtime.state.get()).toMatchObject({ family: next, mode: "virtual", phase: "selecting",
        f2lSelection: { library: "advanced", position: "BL" }, target: null, result: null,
        setup: "", setupProgress: null, recovery: null, recoveryPending: false,
        liveMoves: [], guide: null, displayFacelets: "" });
      expect(runtime.elapsedAt(performance.now())).toBeNull();
      const reset = runtime.state.get();
      feedMove(runtime, "R");
      expect(runtime.state.get()).toBe(reset);
    }
  });
});

describe("Training completed-attempt boundary", () => {
  it.each(["setup", "virtual"] as const)("emits one completed %s F2L fact before reload and never re-emits on Again", async mode => {
    const completed = vi.fn();
    const saveSolve = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const runtime = createRuntime(new CubeModel(kpuzzle), completed);
    configureInputs(runtime, state => ({ ...state, virtualCube: true }));
    await runtime.setTrainingMode(mode);
    await runtime.selectF2lCase("F2L 4");
    const target = runtime.state.get().target!;
    const setup = runtime.state.get().setup;
    for (const token of setup.split(/\s+/).filter(Boolean)) feedMove(runtime, cubeMove(token, trainingGrip(target)));
    expect(completed).not.toHaveBeenCalled();
    expect(runtime.state.get().phase).toBe("ready");
    for (const token of referenceExecutionSignature(target.references[0].alg)!) feedMove(runtime, cubeMove(token, trainingGrip(target)));
    const result = runtime.state.get().result;
    expect(completed).toHaveBeenCalledExactlyOnceWith({ activity: "single", drillRunId: null, drillRound: null, mode, target, result });
    expect(result).not.toBeNull();
    runtime.physicalStateChanged();
    runtime.againTraining(); await Promise.resolve();
    expect(completed).toHaveBeenCalledOnce();
    expect(saveSolve).not.toHaveBeenCalled();
  });

  it.each(["reset", "family", "mode", "leave"])("does not record abandoned attempts on %s", async action => {
    const completed = vi.fn();
    const runtime = createRuntime(new CubeModel(kpuzzle), completed);
    await runtime.setTrainingMode("virtual"); await runtime.selectF2lCase("F2L 4");
    feedMove(runtime, "R");
    if (action === "reset") runtime.resetTraining();
    if (action === "family") runtime.setTrainingFamily("oll");
    if (action === "mode") await runtime.setTrainingMode("setup");
    if (action === "leave") runtime.leave();
    expect(completed).not.toHaveBeenCalled();
  });

  it("emits the exact solve-step identity rather than the remembered F2L catalogue", async () => {
    const completed = vi.fn();
    const runtime = createRuntime(new CubeModel(kpuzzle), completed);
    await runtime.setTrainingMode("virtual");
    const built = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    const execution = f2lCubeAlgorithm(BASIC_CASES[0].algorithms.FR[0], f2lTrainingGrip(built.info)).split(" ");
    const solve: Solve = { ...solveFor("timer"), scrambledFacelets: patternToFacelets(built.pattern),
      moves: execution.map((move, i) => ({ move, t: (i + 1) * 100 })),
      analysis: { method: "CFOP", crossFace: built.info.crossFace, rotation: "", steps: [], solvingMs: 1000,
        tps: 3, totalRecognitionMs: 0, totalExecutionMs: 1000, stepsSkipped: 0, turnsAfterSolution: 0, pauses: [],
        sliceTurns: execution.length, faceTurns: execution.length, quarterTurns: execution.length } };
    await runtime.practiceSolveStep(solve, { name: "F2L Slot 1", slot: built.info.slot, fromMove: 0, toMove: execution.length, skipped: false } as SolveStep);
    const target = runtime.state.get().target!;
    expect(target?.origin.kind).toBe("solve-step");
    for (const token of execution) feedMove(runtime, token);
    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0][0].target).toBe(target);
    expect(completed.mock.calls[0][0].target.origin).toMatchObject({ kind: "solve-step", solveId: solve.id, stepName: "F2L Slot 1" });
  });

  it.each(["basic", "advanced"] as const)("random F2L delegates within the %s library and keeps position", async library => {
    const runtime = createRuntime(new CubeModel(kpuzzle));
    runtime.setF2lLibrary(library); await runtime.selectF2lPosition("FL");
    const select = vi.spyOn(runtime, "selectF2lCase").mockResolvedValue();
    const cases = F2L_TRAINING_CATALOGUES[library].cases;
    const random = runtimeRandom;
    for (const index of [0, cases.length - 1]) {
      random.mockReturnValue((index + 0.5) / cases.length);
      runtime.randomTrainingCase("f2l");
      expect(select).toHaveBeenLastCalledWith(cases[index].name);
      expect(runtime.state.get().f2lSelection).toEqual({ library, position: "FL" });
    }
  });
});

describe("TrainingRuntime continuous virtual Drill", () => {
  function drill(family: "f2l" | "oll" | "pll" = "f2l", extra: Partial<TrainingDependencies> = {}) {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    runtimeRandom.mockReturnValue(0);
    const completed = vi.fn();
    const model = new CubeModel(kpuzzle); model.applyMove("B");
    const runtime = createRuntime(model, completed, extra);
    runtime.setTrainingFamily(family); runtime.setTrainingActivity("drill");
    const advance = (ms: number) => { now += ms; return runtime.tick(now); };
    const solve = () => {
      const target = runtime.state.get().target!;
      for (const token of referenceExecutionSignature(target.references[0].alg)!) {
        now += 100;
        feedMove(runtime, cubeMove(token, trainingGrip(target)));
      }
    };
    return { runtime, model, completed, advance, solve, wait: (ms: number) => { now += ms; } };
  }
  it("snapshots the completed round identity before publishing its result", () => {
    const { runtime, advance, solve, completed } = drill("f2l", { createId: () => "completed-run" });
    runtime.setDrillCases(["F2L 4"]); runtime.startDrill(); advance(2000);
    const unsubscribe = runtime.state.subscribe(() => {
      if (runtime.state.get().phase === "result") runtime.stopDrill();
    });
    solve(); unsubscribe();
    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0][0]).toMatchObject({ drillRunId: "completed-run", drillRound: 1 });
  });
  it("evaluates Drill against My algorithm, uses effective outcome delta and resolves later rounds afresh", () => {
    const built = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase("basic", "F2L 1")!);
    let preference = { algorithm: built.info.references[1].sourceAlg };
    const { runtime, advance, solve, completed } = drill("f2l", { getTrainingAlgorithmPreference: () => preference });
    runtime.setDrillCases(["F2L 1"]); runtime.startDrill(); advance(2000); solve();
    const result = completed.mock.calls[0][0].result;
    expect(result.matchedPreferred).toBe(false);
    expect(runtime.state.get().drill.outcomes[0]).toMatchObject({ outcome: "solved", delta: result.preferredDelta });
    preference = { algorithm: built.info.references[0].sourceAlg };
    advance(2000); expect(runtime.state.get().preferredReference?.alg).toBe(runtime.state.get().target!.references[0].alg);
    expect(runtime.state.get().preferredReference?.alg).not.toBe(built.info.references[0].alg);
    solve(); expect(completed.mock.calls[1][0].result.matchedPreferred).toBe(true);
  });
  it("stops RAF while recognizing, restarts on the first move, and includes the unticked wait in case time", () => {
    const startClock = vi.fn(), elapsed = new Store(0);
    const { runtime, advance, wait, solve, completed } = drill("f2l", { startClock, elapsed });
    runtime.setDrillCases(["F2L 4"]); runtime.startDrill();
    expect(advance(1000)).toBe(true); expect(advance(1000)).toBe(false);
    const publish = vi.spyOn(elapsed, "set");
    expect(advance(0)).toBe(false); expect(publish).not.toHaveBeenCalled();
    startClock.mockClear(); wait(1500);
    // A harmless quarter turn starts solving; undo it then execute the reference.
    feedMove(runtime, "B"); expect(startClock).toHaveBeenCalledOnce();
    expect(advance(100)).toBe(true); feedMove(runtime, "B'"); solve();
    expect(completed).toHaveBeenCalledOnce(); expect(completed.mock.calls[0][0].result.caseTimeMs).toBeGreaterThan(1500);
    expect(advance(1000)).toBe(true); expect(advance(1000)).toBe(false);
    expect(runtime.state.get().phase).toBe("ready");
  });
  it("records solved/skip outcomes once and discards only incomplete work on Stop", () => {
    const { runtime, advance, solve, completed } = drill();
    runtime.setDrillCases(["F2L 4", "F2L 5"]); runtime.setDrillStrategy("weighted"); runtime.startDrill(); advance(2000); solve();
    const result = runtime.state.get().result!;
    expect(runtime.state.get().drill.outcomes).toEqual([expect.objectContaining({ caseId: "F2L 4", outcome: "solved",
      caseTimeMs: result.caseTimeMs, moveSpanMs: result.elapsedMs, stm: result.stm, delta: result.delta, completedAt: expect.any(Number) })]);
    advance(2000); runtime.skipDrillCase(); runtime.skipDrillCase();
    expect(runtime.state.get().drill.outcomes).toHaveLength(2);
    expect(runtime.state.get().drill.outcomes[1]).toMatchObject({ caseId: "F2L 5", outcome: "skipped" });
    advance(2000); feedMove(runtime, "B"); runtime.stopDrill();
    expect(completed).toHaveBeenCalledOnce(); expect(runtime.state.get().drill).toMatchObject({ status: "summary", outcomes: expect.any(Array) });
    expect(runtime.state.get().drill.outcomes).toHaveLength(2);
    runtime.startDrill(); expect(runtime.state.get().drill.running).toBe(false);
    runtime.finishDrillSummary();
    expect(runtime.state.get().drill).toMatchObject({ status: "configuring", selectedCaseIds: ["F2L 4", "F2L 5"], strategy: "weighted", outcomes: [], round: 0 });
    runtime.startDrill(); expect(runtime.state.get().drill.outcomes).toEqual([]);
  });
  it("weak-case action configures only weak selected IDs and leave cancels summary/run state", () => {
    const { runtime, advance } = drill(); runtime.setDrillCases(["F2L 4", "F2L 5"]); runtime.startDrill(); advance(2000);
    runtime.skipDrillCase(); runtime.stopDrill(); runtime.finishDrillSummary(true);
    expect(runtime.state.get().drill).toMatchObject({ status: "configuring", running: false, selectedCaseIds: ["F2L 4"], strategy: "weighted", outcomes: [] });
    runtime.startDrill(); advance(2000); runtime.skipDrillCase(); runtime.stopDrill(); runtime.leave();
    expect(runtime.state.get().drill).toMatchObject({ status: "configuring", outcomes: [], selectedCaseIds: ["F2L 4"] });
  });
  it("keeps captured Execution summary context through Settings edits and clears incompatible configuration on exit", () => {
    const { runtime, advance } = drill("oll"); runtime.setDrillCases(["27"]); runtime.startDrill(); advance(2000);
    runtime.skipDrillCase(); runtime.stopDrill();
    configureInputs(runtime, s => ({ ...s, settings: { ...s.settings, ollTrainingSet: "2look" } }));
    runtime.catalogueContextChanged();
    expect(runtime.state.get().drill).toMatchObject({ status: "summary", context: { family: "oll", trainingSet: "full" }, selectedCaseIds: ["27"] });
    runtime.finishDrillSummary(); expect(runtime.state.get().drill).toMatchObject({ status: "configuring", selectedCaseIds: [] });
  });
  it("preserves a Recognition summary and weak pool until its catalogue context is restored", () => {
    const { runtime, advance } = drill("oll"); runtime.setDrillTask("recognition"); runtime.setDrillCases(["27", "26"]);
    runtime.startDrill(); advance(2000); runtime.skipDrillCase(); runtime.stopDrill();
    configureInputs(runtime, s => ({ ...s, settings: { ...s.settings, ollTrainingSet: "2look" } }));
    runtime.catalogueContextChanged();
    const summary = runtime.state.get(); runtime.finishDrillSummary(true);
    expect(runtime.state.get()).toBe(summary);
    configureInputs(runtime, s => ({ ...s, settings: { ...s.settings, ollTrainingSet: "full" } }));
    runtime.finishDrillSummary(true); expect(runtime.state.get().drill).toMatchObject({ task: "recognition", status: "configuring", selectedCaseIds: ["26"] });
  });
  it.each(["leave", "activity"])("reconciles changed catalogue IDs when exiting summary through %s", exit => {
    const { runtime, advance } = drill("oll"); runtime.setDrillCases(["27"]); runtime.startDrill(); advance(2000);
    runtime.skipDrillCase(); runtime.stopDrill();
    configureInputs(runtime, s => ({ ...s, settings: { ...s.settings, ollTrainingSet: "2look" } }));
    runtime.catalogueContextChanged();
    if (exit === "leave") runtime.leave(); else { runtime.setTrainingActivity("single"); runtime.setTrainingActivity("drill"); }
    expect(runtime.state.get().drill).toMatchObject({ status: "configuring", selectedCaseIds: [], outcomes: [] });
  });
  it("starts empty, rejects an empty pool, and conceals targets throughout the initial countdown", () => {
    const { runtime, model, advance } = drill();
    expect(runtime.state.get().drill.selectedCaseIds).toEqual([]);
    runtime.startDrill(); expect(runtime.state.get().drill.running).toBe(false);
    runtime.setDrillCases(["F2L 4"]); const physical = model.facelets;
    runtime.startDrill();
    expect(runtime.state.get()).toMatchObject({ activity: "drill", mode: "virtual", target: null, result: null, drill: { running: true, round: 0 } });
    expect(runtime.drillCountdown.get()).toBe(2000);
    expect(model.facelets).toBe(physical);
    const state = runtime.state.get();
    expect(advance(1999)).toBe(true);
    expect(runtime.state.get()).toBe(state); // RAF changes only the narrow countdown Store.
    expect(runtime.drillCountdown.get()).toBe(1);
    expect(runtime.state.get().target).toBeNull();
    advance(1);
    expect(runtime.state.get()).toMatchObject({ phase: "ready", drill: { round: 1, lastCaseId: "F2L 4" } });
    expect(runtime.state.get().target?.origin).toMatchObject({ kind: "catalog", caseName: "F2L 4" });
    expect(runtime.drillCountdown.get()).toBeNull(); expect(model.facelets).toBe(physical);
  });
  it("starts case timing after target/reference preparation, at case publication", () => {
    let clock = 100;
    const buildGuide = trainingDomain.buildTrainingGuide;
    vi.spyOn(trainingDomain, "buildTrainingGuide").mockImplementation((...args) => { clock += 50; return buildGuide(...args); });
    const completed = vi.fn();
    const runtime = createRuntime(new CubeModel(kpuzzle), completed, { now: () => clock });
    runtime.setTrainingActivity("drill"); runtime.setDrillCases(["F2L 4"]); runtime.startDrill();
    clock = 2100; runtime.tick(clock); // Preparation takes 50 ms before publication.
    const target = runtime.state.get().target!;
    clock = 2250;
    for (const token of referenceExecutionSignature(target.references[0].alg)!) feedMove(runtime, cubeMove(token, trainingGrip(target)));
    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0][0].result.caseTimeMs).toBe(100);
  });
  it.each(["f2l", "oll", "pll"] as const)("completes %s through the shared virtual path and preserves result until countdown expiry", family => {
    const { runtime, completed, advance, solve } = drill(family);
    runtime.setDrillCases([family === "f2l" ? "F2L 4" : family === "oll" ? "27" : "T"]);
    runtime.startDrill(); advance(2000); advance(500);
    const target = runtime.state.get().target;
    solve();
    expect(completed).toHaveBeenCalledOnce();
    const fact = completed.mock.calls[0][0] as CompletedTrainingAttempt;
    expect(fact).toMatchObject({ activity: "drill", mode: "virtual", target, result: { matchedReferenceRank: 1 } });
    expect(fact.result.caseTimeMs).toBeGreaterThan(500);
    expect(runtime.state.get()).toMatchObject({ phase: "result", drill: { lastOutcome: "solved" } });
    expect(runtime.drillCountdown.get()).toBe(2000);
    feedMove(runtime, "R"); expect(completed).toHaveBeenCalledOnce();
    advance(1999); expect(runtime.state.get().target).toBe(target); expect(runtime.state.get().result).toBe(fact.result);
    advance(1); expect(runtime.state.get()).toMatchObject({ phase: "ready", result: null, drill: { round: 2, lastOutcome: null } });
    expect(runtime.state.get().target).not.toBe(target);
  });
  it("cycles catalogue order, clears results each round, and restarts from the first selected case", () => {
    const { runtime, advance } = drill();
    runtime.setDrillCases(["F2L 5", "F2L 4"]);
    expect(runtime.state.get().drill.selectedCaseIds).toEqual(["F2L 4", "F2L 5"]);
    runtime.startDrill();
    for (const name of ["F2L 4", "F2L 5", "F2L 4"]) {
      advance(2000); expect(runtime.state.get().drill.lastCaseId).toBe(name);
      runtime.skipDrillCase();
    }
    runtime.stopDrill(); expect(runtime.state.get().drill.selectedCaseIds).toEqual(["F2L 4", "F2L 5"]);
    runtime.finishDrillSummary(); runtime.startDrill(); advance(2000); expect(runtime.state.get().drill.lastCaseId).toBe("F2L 4");
  });
  it("Random avoids the previous case and reads current history for each weighted round", () => {
    const history = vi.fn(() => []);
    const { runtime, advance } = drill("f2l", { rng: runtimeRandom, getTrainingAttempts: history });
    runtime.setDrillCases(["F2L 4", "F2L 5"]); runtime.setDrillStrategy("random"); runtime.startDrill();
    advance(2000); expect(runtime.state.get().drill.lastCaseId).toBe("F2L 4");
    runtime.skipDrillCase(); advance(2000); expect(runtime.state.get().drill.lastCaseId).toBe("F2L 5");
    runtime.stopDrill(); runtime.finishDrillSummary(); runtime.setDrillStrategy("weighted"); runtime.startDrill();
    advance(2000); runtime.skipDrillCase(); advance(2000);
    expect(history).toHaveBeenCalledTimes(4);
    expect(runtime.state.get().drill.lastCaseId).toBe("F2L 5");
  });
  it("skip emits no completion, reveals the same target, and is unavailable after any turn", () => {
    const { runtime, completed, advance } = drill();
    runtime.setDrillCases(["F2L 4"]); runtime.startDrill(); advance(2000);
    const target = runtime.state.get().target;
    runtime.skipDrillCase(); runtime.skipDrillCase();
    expect(runtime.state.get()).toMatchObject({ phase: "result", target, drill: { lastOutcome: "skipped" } });
    expect(runtime.drillCountdown.get()).toBe(2000); expect(completed).not.toHaveBeenCalled();
    advance(2000); feedMove(runtime, "B");
    expect(runtime.state.get().phase).toBe("solving"); runtime.skipDrillCase();
    expect(runtime.state.get().phase).toBe("solving"); expect(runtime.drillCountdown.get()).toBeNull();
  });
  it.each(["countdown", "ready", "solving", "solved", "skipped"])("stop safely cancels %s and retains configuration without recording an incomplete attempt", phase => {
    const { runtime, completed, advance, solve } = drill();
    runtime.setDrillCases(["F2L 4"]); runtime.setDrillStrategy("weighted"); runtime.startDrill();
    if (phase !== "countdown") advance(2000);
    if (phase === "solving") feedMove(runtime, "B");
    if (phase === "solved") solve();
    if (phase === "skipped") runtime.skipDrillCase();
    runtime.stopDrill();
    expect(runtime.state.get()).toMatchObject({ activity: "drill", phase: "selecting", target: null, result: null,
      drill: { running: false, status: phase === "solved" || phase === "skipped" ? "summary" : "configuring", selectedCaseIds: ["F2L 4"], strategy: "weighted" } });
    expect(runtime.drillCountdown.get()).toBeNull(); expect(advance(5000)).toBe(false);
    expect(completed).toHaveBeenCalledTimes(phase === "solved" ? 1 : 0);
  });
  it("preserves position changes in configuration, rejects run-time library/position edits, and clears incompatible family/library pools", async () => {
    const { runtime } = drill(); runtime.setDrillCases(["F2L 4"]);
    await runtime.selectF2lPosition("FL"); expect(runtime.state.get().drill.selectedCaseIds).toEqual(["F2L 4"]);
    runtime.startDrill(); await runtime.selectF2lPosition("BL"); runtime.setF2lLibrary("advanced");
    expect(runtime.state.get().f2lSelection).toEqual({ library: "basic", position: "FL" });
    runtime.setDrillCases([]); runtime.setDrillStrategy("random");
    expect(runtime.state.get().drill).toMatchObject({ selectedCaseIds: ["F2L 4"], strategy: "sequence" });
    runtime.setTrainingFamily("oll");
    expect(runtime.state.get()).toMatchObject({ activity: "drill", family: "oll", drill: { running: false, selectedCaseIds: [] } });
    runtime.setTrainingFamily("f2l"); runtime.setDrillCases(["F2L 4"]); runtime.setF2lLibrary("advanced");
    expect(runtime.state.get().drill.selectedCaseIds).toEqual([]);
  });
  it("set invalidation cancels an initial last-layer countdown as well as a revealed target", () => {
    const { runtime, advance } = drill("oll"); runtime.setDrillCases(["27"]); runtime.startDrill();
    runtime.catalogueContextChanged();
    expect(runtime.state.get().drill).toMatchObject({ running: false, selectedCaseIds: [] });
    configureInputs(runtime, s => ({ ...s, settings: { ...s.settings, ollTrainingSet: "2look" } }));
    runtime.setDrillCases(["Sune"]); runtime.startDrill(); advance(2000); runtime.catalogueContextChanged();
    expect(runtime.state.get()).toMatchObject({ activity: "drill", target: null, drill: { running: false, selectedCaseIds: [] } });
  });
  it("exact solve-step practice stops Drill and remains Single", async () => {
    const lookup = vi.fn(() => ({ algorithm: "R U R'" }));
    const { runtime } = drill("oll", { getTrainingAlgorithmPreference: lookup }); runtime.setDrillCases(["27"]); runtime.startDrill();
    const built = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", 0);
    const solve = solveFor("s"); solve.scrambledFacelets = patternToFacelets(built.pattern);
    const moves = referenceExecutionSignature(built.info.references[0].alg)!.map((token, index) => ({ move: cubeMove(token, trainingGrip(built.info)), t: index * 100 }));
    solve.moves = moves; solve.analysis = { method: "CFOP", crossFace: "U", rotation: "", steps: [], solvingMs: 1000,
      tps: 3, totalRecognitionMs: 0, totalExecutionMs: 1000, stepsSkipped: 0, turnsAfterSolution: 0, pauses: [],
      sliceTurns: moves.length, faceTurns: moves.length, quarterTurns: moves.length };
    await runtime.practiceSolveStep(solve, { name: "OLL", fromMove: 0, toMove: moves.length, case: "27", moves: moves.map(m => m.move).join(" "), recordedMoves: moves, skipped: false, hasTurns: true, timeMs: 1000, recognitionMs: 0, executionMs: 1000, cumulativeMs: 1000, sliceTurns: moves.length, faceTurns: moves.length, quarterTurns: moves.length, tps: 1, slot: null });
    expect(runtime.state.get().preferredReference).toBeNull();
    expect(runtime.state.get()).toMatchObject({ activity: "single", drill: { running: false }, target: { origin: { kind: "solve-step" } } });
    expect(runtime.drillCountdown.get()).toBeNull();
  });
});


describe("TrainingRuntime personal benchmark", () => {
  it("refreshes guidance without replacing the target or setup, and removal restores canonical guidance", async () => {
    let preference: { algorithm: string } | null = null;
    const runtime = createRuntime(new CubeModel(kpuzzle), undefined, { getTrainingAlgorithmPreference: () => preference });
    await runtime.selectF2lCase("F2L 1");
    const before = runtime.state.get();
    preference = { algorithm: before.target!.references[1].sourceAlg };
    expect(runtime.refreshPreferredAlgorithm()).toBe(true);
    const after = runtime.state.get();
    expect(after.target).toBe(before.target); expect(after.setupProgress).toBe(before.setupProgress);
    expect(after.setup).toBe(before.setup); expect(after.phase).toBe(before.phase);
    expect(after.displayFacelets).toBe(before.displayFacelets); expect(after.displayRevision).toBe(before.displayRevision);
    expect(after.preferredReference?.alg).toBe(before.target!.references[1].alg);
    expect(after.guide?.moves.join(" ")).toBe(after.preferredReference?.alg);
    preference = null; runtime.refreshPreferredAlgorithm();
    expect(runtime.state.get().preferredReference).toBeNull();
    expect(runtime.state.get().guide?.moves.join(" ")).toBe(before.guide?.moves.join(" "));
  });
  it("freezes the benchmark after the first turn and snapshots personal result facts", async () => {
    const built = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    let preference: { algorithm: string } | null = { algorithm: built.info.references[1].sourceAlg };
    const runtime = createRuntime(new CubeModel(kpuzzle), undefined, { getTrainingAlgorithmPreference: () => preference });
    await runtime.setTrainingMode("virtual"); await runtime.selectF2lCase(BASIC_CASES[0].name);
    const target = runtime.state.get().target!, preferred = runtime.state.get().preferredReference!;
    const execution = referenceExecutionSignature(preferred.alg)!;
    feedMove(runtime, cubeMove(execution[0], trainingGrip(target)));
    expect(runtime.state.get().phase).toBe("solving");
    preference = null;
    expect(runtime.refreshPreferredAlgorithm()).toBe(false);
    expect(runtime.state.get().preferredReference).toBe(preferred);
    for (const move of execution.slice(1)) feedMove(runtime, cubeMove(move, trainingGrip(target)));
    const result = runtime.state.get().result!;
    expect(result).toMatchObject({ preferredAlg: preferred.alg, preferredStm: preferred.stm, matchedPreferred: true, preferredDelta: 0 });
    runtime.refreshPreferredAlgorithm(); expect(runtime.state.get().result).toBe(result);
    expect(target.references).toEqual(built.info.references);
  });
  it("falls back to canonical guidance when a stale preference no longer resolves", async () => {
    const runtime = createRuntime(new CubeModel(kpuzzle), undefined, { getTrainingAlgorithmPreference: () => ({ algorithm: "R" }) });
    await runtime.setTrainingMode("virtual"); await runtime.selectF2lCase("F2L 1");
    expect(runtime.state.get().preferredReference).toBeNull();
    expect(runtime.state.get().guide?.moves.join(" ")).toBe(runtime.state.get().target!.references[0].alg);
  });
});


it.each([["oll", "27", "full"], ["oll", "L-Shape", "2look"], ["pll", "Headlights", "2look"]] as const)
  ("resolves stable personal %s %s source across virtual randomized targets", async (family, caseId, set) => {
    const built = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, set);
    const sourceAlg = built.info.references[0].sourceAlg;
    const keys: string[] = [];
    const runtime = createRuntime(new CubeModel(kpuzzle), undefined, { getTrainingAlgorithmPreference: key => { keys.push(key); return { algorithm: sourceAlg }; } });
    configureInputs(runtime, s => ({ ...s, settings: { ...s.settings, ollTrainingSet: set, pllTrainingSet: set } }));
    runtime.setTrainingFamily(family); await runtime.setTrainingMode("virtual");
    runtimeRandom.mockReturnValue(0);
    await runtime.selectLastLayerCase(family, caseId);
    const first = runtime.state.get().target!, preferred = runtime.state.get().preferredReference!;
    expect(preferred).not.toBeNull();
    runtimeRandom.mockReturnValue(0.75);
    await runtime.selectLastLayerCase(family, caseId);
    expect(runtime.state.get().target).not.toBe(first); expect(runtime.state.get().target).toMatchObject({ auf: 3 });
    expect(runtime.state.get().preferredReference).not.toBeNull();
    expect(new Set(keys).size).toBe(1);
  });

describe("Recognition Drill lifecycle and shared smart generation", () => {
  function recognitionRuntime() {
    let clock = 100, ids = 0;
    const completed = vi.fn(), executionCompleted = vi.fn(), startClock = vi.fn();
    const runtime = createRuntime(new CubeModel(kpuzzle), executionCompleted, { now: () => clock,
      createId: () => `run-${++ids}`, onRecognitionCompleted: completed, startClock });
    runtime.setTrainingActivity("drill"); runtime.setDrillTask("recognition");
    runtime.setDrillCases(["F2L 4", "F2L 5", "F2L 6"]);
    return { runtime, completed, executionCompleted, startClock, advance: (ms: number) => { clock += ms; return runtime.tick(clock); },
      wait: (ms: number) => { clock += ms; } };
  }
  it("requires two cases, publishes only after countdown, offers bounded valid choices and sleeps while awaiting an answer", () => {
    const { runtime, advance, startClock } = recognitionRuntime();
    runtime.setDrillCases(["F2L 4"]); runtime.startDrill(); expect(runtime.state.get().drill.running).toBe(false);
    runtime.setDrillCases(["F2L 4", "F2L 5"]); runtime.startDrill();
    expect(runtime.state.get().target).toBeNull(); expect(advance(1999)).toBe(true); expect(runtime.state.get().target).toBeNull();
    expect(advance(1)).toBe(false); expect(runtime.state.get().guide).toBeNull();
    const state = runtime.state.get(); expect(state.drill).toMatchObject({ runId: "run-1", round: 1, task: "recognition" });
    expect(state.recognition?.choices.map(c => c.caseId).sort()).toEqual(["F2L 4", "F2L 5"]);
    startClock.mockClear(); expect(advance(500)).toBe(false); expect(startClock).not.toHaveBeenCalled();
    expect(runtime.state.get()).toBe(state);
  });
  it.each([true, false])("finalizes a %s answer once, reveals feedback and preserves it until the next publication", correct => {
    const { runtime, completed, executionCompleted, advance, wait } = recognitionRuntime();
    runtime.startDrill(); advance(2000); const revealed = runtime.state.get(), answer = correct ? "F2L 4" : "F2L 5";
    runtime.submitTrainingRecognition("outside"); expect(runtime.state.get()).toBe(revealed);
    wait(700); runtime.submitTrainingRecognition(answer);
    expect(completed).toHaveBeenCalledExactlyOnceWith({ drillRunId: "run-1", drillRound: 1,
      target: { family: "f2l", library: "basic", position: "FR", caseName: "F2L 4" }, answerCaseId: answer, responseMs: 700 });
    expect(executionCompleted).not.toHaveBeenCalled();
    const result = runtime.state.get(); expect(result.target).toBe(revealed.target);
    expect(result.recognition?.result).toMatchObject({ correct, answerCaseId: answer, correctCaseId: "F2L 4", responseMs: 700 });
    expect(result.drill.outcomes).toHaveLength(1); expect(runtime.drillCountdown.get()).toBe(2000);
    runtime.submitTrainingRecognition(answer); expect(completed).toHaveBeenCalledOnce();
    advance(1999); expect(runtime.state.get()).toBe(result); advance(1);
    expect(runtime.state.get().recognition?.result).toBeNull(); expect(runtime.state.get().drill.round).toBe(2);
    runtime.submitTrainingRecognition("F2L 5"); expect(completed.mock.calls[1][0]).toMatchObject({ drillRunId: "run-1", drillRound: 2 });
    runtime.stopDrill(); expect(runtime.state.get().drill.status).toBe("summary");
    runtime.finishDrillSummary(); expect(runtime.state.get().drill).toMatchObject({ task: "recognition", strategy: "sequence", status: "configuring", selectedCaseIds: ["F2L 4", "F2L 5", "F2L 6"] });
    runtime.startDrill(); expect(runtime.state.get().drill.runId).toBe("run-2");
  });
  it("timestamps after target/reference preparation, ignores cube turns and keeps skips ephemeral", () => {
    let clock = 100;
    const build = trainingDomain.buildTrainingGuide;
    vi.spyOn(trainingDomain, "buildTrainingGuide").mockImplementation((...args) => { clock += 50; return build(...args); });
    const completed = vi.fn(), runtime = createRuntime(new CubeModel(kpuzzle), undefined, { now: () => clock, onRecognitionCompleted: completed });
    runtime.setTrainingActivity("drill"); runtime.setDrillTask("recognition"); runtime.setDrillCases(["F2L 4", "F2L 5"]);
    runtime.startDrill(); clock = 2100; runtime.tick(clock);
    const publishedAt = clock, state = runtime.state.get();
    for (const turn of ["R", "U", "R'", "U'"]) feedMove(runtime, turn);
    expect(runtime.state.get()).toBe(state); expect(runtime.state.get().liveMoves).toEqual([]);
    clock = publishedAt + 300; runtime.submitTrainingRecognition("F2L 4"); expect(completed.mock.calls[0][0].responseMs).toBe(300);
    clock += 2000; runtime.tick(clock); runtime.skipDrillCase(); expect(completed).toHaveBeenCalledOnce();
    expect(runtime.state.get().drill.lastOutcome).toBe("skipped"); expect(runtime.state.get().target).not.toBeNull();
  });
  it("weak-case action retains Recognition task and context cancellation clears answer state", () => {
    const { runtime, advance } = recognitionRuntime(); runtime.startDrill(); advance(2000);
    runtime.submitTrainingRecognition("F2L 5"); runtime.stopDrill(); runtime.finishDrillSummary(true);
    expect(runtime.state.get().drill).toMatchObject({ task: "recognition", selectedCaseIds: ["F2L 4"], status: "configuring" });
    runtime.setDrillCases(["F2L 4", "F2L 5"]); runtime.startDrill(); advance(2000);
    const ready = runtime.state.get(); runtime.setF2lLibrary("advanced"); expect(runtime.state.get()).toBe(ready);
    runtime.setTrainingFamily("oll"); expect(runtime.state.get()).toMatchObject({ recognition: null, target: null, drill: { running: false, selectedCaseIds: [] } });
    expect(runtime.drillCountdown.get()).toBeNull();
  });
  it("varies F2L Again using injected RNG, preserves identity and stable source preferences, and tracks exact direct setup", async () => {
    const model = new CubeModel(kpuzzle), caseData = findF2lTrainingCase("basic", "F2L 4")!;
    const source = caseData.algorithms.FR[0], keys: string[] = [];
    const runtime = createRuntime(model, undefined, { rng: () => 0.5, getTrainingAlgorithmPreference: key => { keys.push(key); return { algorithm: source }; } });
    configureInputs(runtime, s => ({ ...s, virtualCube: true })); await runtime.selectF2lCase("F2L 4");
    const target = f2lTargetOf(runtime)!, expected = buildF2lCatalogueTarget(kpuzzle, caseData, "FR", undefined, 2);
    expect(target.auf).toBe(2); expect(runtime.state.get().setup).toBeTruthy();
    for (const move of f2lCubeAlgorithm(runtime.state.get().setup, trainingGrip(target)).split(" ")) feedMove(runtime, move);
    expect(runtime.state.get().phase).toBe("ready"); expect(patternToFacelets(model.pattern)).toBe(patternToFacelets(expected.pattern));
    await runtime.setTrainingMode("virtual"); const before = runtime.state.get(), preference = before.preferredReference!;
    runtime.againTraining(); expect(f2lTargetOf(runtime)?.auf).not.toBe((before.target as F2lTrainingTargetInfo).auf);
    expect(runtime.state.get().displayFacelets).not.toBe(before.displayFacelets); expect(runtime.state.get().preferredReference).not.toBeNull();
    expect(new Set(keys).size).toBe(1); expect(runtime.state.get().preferredReference?.alg).not.toBe(preference.alg);
    expect(runtime.state.get().target?.references.map(r => r.sourceAlg)).toEqual(before.target?.references.map(r => r.sourceAlg));
  });
});

it("accepts an already exact physical generated F2L target without asking the generic solver", async () => {
  const built = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0], "FR", undefined, 1);
  const between = vi.spyOn(solver, "algBetween");
  const runtime = createRuntime(new CubeModel(kpuzzle, built.pattern), undefined, { rng: () => 0.25 });
  configureInputs(runtime, s => ({ ...s, virtualCube: true })); await runtime.selectF2lCase(BASIC_CASES[0].name);
  expect(runtime.state.get()).toMatchObject({ phase: "ready", setup: "" }); expect(between).not.toHaveBeenCalled();
});
