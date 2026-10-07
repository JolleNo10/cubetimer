import { analyseSolve } from "../cube/analysis";
import { Alg } from "cubing/alg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildF2lCatalogueTarget,
  f2lTrainingGrip, referenceExecutionSignature
} from "../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../cube/f2lTrainingCases";
import { buildLastLayerCatalogueTarget, isLastLayerTrainingComplete, lastLayerCaseIds } from "../cube/lastLayerTraining";
import { CubeModel, patternToFacelets } from "../cube/model";
import { invert, reorientMove } from "../cube/orientation";
import { get3x3x3 } from "../cube/puzzle";
import { DEFAULT_EVENT_ID } from "../cube/scramble";
import * as solver from "../cube/solver";
import { cubeMove } from "../cube/frames";
import { trainingGrip } from "../cube/training";
import * as drillPolicy from "../features/training/trainingDrill";
import type { TrainingPlanBlock } from "../features/training/trainingPlanner";
import { Controller } from "./Controller";
import * as db from "../infrastructure/persistence/db";
import { formatSolveCsv } from "../features/data-transfer/solveCsv";
import { DEFAULT_SETTINGS, type Session, type Solve, type TrainingAttempt, type TrainingDrillPreset } from "./types";

const kpuzzle = await get3x3x3();
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

beforeEach(() => {
  vi.spyOn(db, "loadTrainingRecognitionAttempts").mockResolvedValue([]);
  vi.spyOn(db, "saveTrainingRecognitionAttempt").mockResolvedValue();
  vi.spyOn(db, "loadTrainingDrillPresets").mockResolvedValue([]);
  vi.spyOn(db, "loadTrainingAlgorithmPreferences").mockResolvedValue([]);
  vi.spyOn(db, "loadTrainingAttempts").mockResolvedValue([]);
  vi.spyOn(db, "saveTrainingAttempt").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

function session(id: string, event: Session["event"] = DEFAULT_EVENT_ID): Session {
  return { id, name: `Session ${id}`, event, createdAt: Number(id) || 0 };
}

function solveFor(sessionId: string): Solve {
  return {
    id: `solve-${sessionId}`,
    sessionId,
    createdAt: 0,
    rawMs: 1000,
    penalty: "none",
    scramble: "R U",
    source: "keyboard",
    moves: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

function stubTimerLoop() {
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;
}

function readyController(
  sessions: Session[],
  sessionId: string,
  solves: Solve[] = [],
  phase: "finished" | "ready" | "inspection" | "solving" = "finished",
): Controller {
  const controller = new Controller(new CubeModel(kpuzzle));
  controller.state.update((state) => ({ ...state, ready: true }));
  controller.sessions.update((state) => ({ ...state, sessions, sessionId, solves, lastSolve: solves.at(-1) ?? null }));
  controller.timer.state.update((state) => ({ ...state, phase }));
  return controller;
}

function stubPersistence() {
  vi.spyOn(db, "saveSession").mockResolvedValue();
  vi.spyOn(db, "loadSolves").mockResolvedValue([]);
  vi.spyOn(db, "deleteSession").mockResolvedValue();
}

describe("Controller Training settings integration", () => {
  it.each(["oll", "pll"] as const)("cancels a running %s target only when its own setting changes", async (family) => {
    stubTimerLoop();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(db, "saveSettings").mockResolvedValue();
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setTrainingFamily(family);
    await controller.setTrainingMode("virtual");
    await controller.selectLastLayerCase(family, family === "oll" ? "27" : "H");
    controller.injectMove("R");
    expect(controller.training.state.get().phase).toBe("solving");
    const before = controller.training.state.get();
    await controller.updateSettings(family === "oll" ? { pllTrainingSet: "2look" } : { ollTrainingSet: "2look" });
    expect(controller.training.state.get()).toBe(before);
    await controller.updateSettings(family === "oll" ? { ollTrainingSet: "2look" } : { pllTrainingSet: "2look" });
    expect(controller.training.state.get()).toMatchObject({ family, mode: "virtual", phase: "selecting", target: null, liveMoves: [], result: null });
    expect(controller.elapsed.get()).toBe(0);
    controller.injectMove("U");
    expect(controller.training.state.get().phase).toBe("selecting");
    expect(controller.snapshot().solves).toEqual([]);
  });
  it("cancels physical setup in progress without changing mode or resurrecting its target", async () => {
    vi.spyOn(db, "saveSettings").mockResolvedValue();
    const pending = deferred<Alg>();
    vi.spyOn(solver, "algBetween").mockReturnValue(pending.promise);
    const controller = new Controller(new CubeModel(kpuzzle));
    const selecting = controller.selectLastLayerCase("oll", "1");
    expect(controller.training.state.get().phase).toBe("preparing");
    await controller.updateSettings({ ollTrainingSet: "2look" });
    pending.resolve(new Alg("R U"));
    await selecting;
    expect(controller.training.state.get()).toMatchObject({ family: "oll", mode: "setup", phase: "selecting", target: null, setup: "" });
  });
  it("leaves F2L Training unchanged when either last-layer setting changes", async () => {
    vi.spyOn(db, "saveSettings").mockResolvedValue();
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    const before = controller.training.state.get();
    await controller.updateSettings({ ollTrainingSet: "2look", pllTrainingSet: "2look" });
    expect(controller.training.state.get()).toBe(before);
  });
});

describe("Controller application-area ownership", () => {
  it("clears the old Training-exit scramble immediately and generates a fallback after adoption fails", async () => {
    const controller = readyController([session("1")], "1");
    controller.setScramble("R U"); controller.setArea("training");
    const pending = deferred<Alg>();
    vi.spyOn(solver, "solveAlg").mockImplementationOnce(async () => { await pending.promise; throw new Error("adoption failed"); });
    const generate = vi.spyOn(controller.timer, "newScramble").mockResolvedValue();
    controller.setArea("timer");
    expect(controller.snapshot()).toMatchObject({ area: "timer", scramble: "", scrambleProgress: null, recovery: null, liveMoves: [] });
    expect(generate).not.toHaveBeenCalled();
    pending.resolve(new Alg());
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(controller.state.get().error).toContain("adoption failed");
  });

  it.each(["applied", "superseded"] as const)("does not generate a fallback for %s Training-exit adoption", async result => {
    const controller = readyController([session("1")], "1");
    controller.setArea("training");
    const adoption = vi.spyOn(controller.timer, "useCubeStateAsScramble").mockResolvedValue(result);
    const generate = vi.spyOn(controller.timer, "newScramble").mockResolvedValue();
    controller.setArea("timer"); await Promise.resolve();
    expect(adoption).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates a fallback when the Training-exit physical pattern is unavailable", async () => {
    const controller = new Controller(); controller.setArea("training");
    const generate = vi.spyOn(controller.timer, "newScramble").mockResolvedValue();
    controller.setArea("timer");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  });

  it("preserves a newer scramble requested after adoption fails but before fallback resumes", async () => {
    const controller = readyController([session("1")], "1");
    controller.setArea("training");
    let reject!: (error: Error) => void;
    vi.spyOn(solver, "solveAlg").mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const generate = vi.spyOn(controller.timer, "newScramble").mockResolvedValue();
    controller.setArea("timer");
    reject(new Error("adoption failed"));
    queueMicrotask(() => controller.setScramble("F"));
    await vi.waitFor(() => expect(controller.timer.state.get().scramble).toBe("F"));
    expect(generate).not.toHaveBeenCalled();
  });

  it("cancels timer work without creating or changing a normal solve", () => {
    const controller = new Controller();
    const solve = { id: "existing" } as Solve;
    controller.timer.state.update((state) => ({ ...state, phase: "solving", solveSource: "smartcube", liveMoves: ["R"] }));
    controller.sessions.update((state) => ({ ...state, solves: [solve], lastSolve: solve }));

    controller.setArea("training");
    controller.injectMove("U");

    expect(controller.snapshot().area).toBe("training");
    expect(controller.snapshot().phase).toBe("scrambling");
    expect(controller.training.state.get().phase).toBe("selecting");
    expect(controller.snapshot().solves).toEqual([solve]);
    expect(controller.snapshot().lastSolve).toBe(solve);
  });

  it.each([
    { area: "timer" as const, phase: "inspection" as const },
    { area: "timer" as const, phase: "solving" as const },
  ])("refuses Statistics while Timer is $phase", ({ area, phase }) => {
    const controller = readyController([session("1")], "1", [], phase);
    controller.state.update((state) => ({ ...state, area }));

    controller.setArea("statistics");

    expect(controller.snapshot().area).toBe("timer");
  });

  it("refuses Statistics while a Training attempt is solving", () => {
    const controller = readyController([session("1")], "1");
    controller.training.state.update((state) => ({ ...state, phase: "solving" }));
    controller.state.update((state) => ({ ...state, area: "training" }));

    controller.setArea("statistics");

    expect(controller.snapshot().area).toBe("training");
  });

  it("keeps idle Timer state and ignores workflow input while Statistics is open", () => {
    const solve = solveFor("1");
    const controller = readyController([session("1")], "1", [solve], "ready");
    controller.timer.state.update((state) => ({ ...state, scramble: "R U", liveMoves: [] }));
    const before = controller.snapshot();

    controller.setArea("statistics");
    controller.injectMove("R");

    expect(controller.snapshot().area).toBe("statistics");
    expect(controller.snapshot().phase).toBe("ready");
    expect(controller.snapshot().sessionId).toBe(before.sessionId);
    expect(controller.snapshot().solves).toEqual(before.solves);
    expect(controller.snapshot().scramble).toBe(before.scramble);
    expect(controller.snapshot().liveMoves).toEqual([]);

    controller.setArea("timer");
    expect(controller.snapshot().area).toBe("timer");
  });

  it("defers Settings-triggered auto-inspection until Statistics returns to Timer", async () => {
    stubTimerLoop();
    const requestFrame = vi.spyOn(globalThis, "requestAnimationFrame");
    const saveSettings = vi.spyOn(db, "saveSettings").mockResolvedValue();
    const controller = readyController([session("1")], "1");
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.settings.set({ ...controller.settings.get(), inspection: true, autoInspection: false, requireScramble: true, slowSolve: false });
    controller.setScramble("R");
    controller.injectMove("R");
    const before = controller.snapshot();
    expect(before.phase).toBe("ready");
    expect(before.scrambleProgress?.done).toBe(true);

    controller.setArea("statistics");
    await controller.updateSettings({ autoInspection: true });

    expect(controller.snapshot().area).toBe("statistics");
    expect(controller.snapshot().phase).toBe(before.phase);
    expect(controller.snapshot().scrambleProgress).toBe(before.scrambleProgress);
    expect(controller.inspectionLeft.get()).toBeNull();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoInspection: true }));

    controller.setArea("timer");

    expect(controller.snapshot().area).toBe("timer");
    expect(controller.snapshot().phase).toBe("inspection");
    expect(controller.snapshot().scrambleProgress?.done).toBe(true);
    expect(controller.inspectionLeft.get()).toBe(15_000);
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it("restores an idle Training target without resetting it", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    const target = controller.training.state.get().target;
    const display = controller.training.state.get().displayFacelets;

    controller.setArea("statistics");
    expect(controller.snapshot().area).toBe("statistics");
    controller.setArea("training");

    expect(controller.training.state.get().target).toBe(target);
    expect(controller.training.state.get().displayFacelets).toBe(display);
  });

  it("loads a statistics snapshot without changing active Timer state", async () => {
    const activeSolve = solveFor("1");
    const controller = readyController([session("1")], "1", [activeSolve], "ready");
    controller.state.update((state) => ({ ...state, area: "statistics" }));
    controller.timer.state.update((state) => ({ ...state, scramble: "R U" }));
    const before = controller.snapshot();
    const historical = solveFor("other");
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1"), session("2", "222")]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([historical]);

    const snapshot = await controller.loadStatisticsSnapshot();

    expect(snapshot.solves).toEqual([historical]);
    expect(controller.snapshot().area).toBe(before.area);
    expect(controller.snapshot().sessionId).toBe(before.sessionId);
    expect(controller.snapshot().solves).toBe(before.solves);
    expect(controller.snapshot().lastSolve).toBe(before.lastSolve);
    expect(controller.snapshot().scramble).toBe(before.scramble);
  });

  it("runs an OLL attempt through the shared virtual Training lifecycle", async () => {
    stubTimerLoop();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("training");
    controller.setTrainingFamily("oll");
    await controller.setTrainingMode("virtual");
    await controller.selectLastLayerCase("oll", "1");

    const target = controller.training.state.get().target;
    if (!target || target.family === "f2l" || target.family !== "oll") throw new Error("OLL target was not loaded");
    const grip = trainingGrip(target);
    const rawMoves = Array.from(new Alg(target.references[0].alg).expand().childAlgNodes())
      .map((node) => cubeMove(node.toString(), grip));
    const expectedTarget = buildLastLayerCatalogueTarget(kpuzzle, "oll", "1", target.auf);
    expect(isLastLayerTrainingComplete(expectedTarget.info, expectedTarget.pattern.applyAlg(new Alg(rawMoves.join(" "))))).toBe(true);
    expect(controller.training.state.get().phase).toBe("ready");
    for (const move of rawMoves) controller.injectMove(move);

    expect(controller.training.state.get().phase).toBe("ready");
    expect(controller.training.state.get().result?.stm).toBeGreaterThan(0);
    expect(controller.snapshot().solves).toEqual([]);
  });

  it("parks Timer for a historical review without adopting the training position", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;
    const controller = new Controller(
      new CubeModel(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg("R U"))),
    );
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    controller.injectMove("L");
    const trainingPosition = patternToFacelets(controller.pattern!);

    controller.returnToTimerReview();

    expect(controller.snapshot().area).toBe("timer");
    expect(controller.snapshot().phase).toBe("finished");
    expect(controller.snapshot().phase).not.toBe("ready");
    expect(controller.snapshot().phase).not.toBe("inspection");
    expect(controller.snapshot().phase).not.toBe("solving");
    expect(controller.training.state.get().phase).toBe("selecting");
    expect(controller.training.state.get().target).toBeNull();
    expect(controller.snapshot().solves).toEqual([]);
    expect(patternToFacelets(controller.pattern!)).toBe(trainingPosition);
    expect(controller.snapshot().scramble).toBe("");
  });

  it("returns to Timer review through Statistics entered from Training", async () => {
    const historicalSolve = solveFor("1");
    const controller = readyController([session("1")], "1", [historicalSolve]);
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.timer.state.update((state) => ({ ...state, scramble: "R U" }));
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    controller.setArea("statistics");
    controller.injectMove("L");
    const before = controller.snapshot();
    const physicalPosition = patternToFacelets(controller.pattern!);
    const adopt = vi.spyOn(controller.timer, "useCubeStateAsScramble").mockResolvedValue("applied");
    const generate = vi.spyOn(controller.timer, "newScramble").mockResolvedValue();

    expect(controller.returnToTimerReview()).toBe(true);
    expect(controller.training.state.get()).toMatchObject({ phase: "selecting", target: null });

    expect(controller.snapshot()).toMatchObject({
      area: "timer",
      phase: "finished",
      sessionId: "1",
      scramble: "",
    });
    expect(controller.snapshot().solves).toBe(before.solves);
    expect(controller.snapshot().lastSolve).toBe(historicalSolve);
    expect(patternToFacelets(controller.pattern!)).toBe(physicalPosition);
    expect(adopt).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();

    controller.setArea("statistics");
    expect(controller.returnToTimerReview()).toBe(false);
    expect(controller.snapshot().area).toBe("statistics");
  });

  it("does not perform Training review return when Statistics was entered from Timer", () => {
    const controller = readyController([session("1")], "1", [solveFor("1")], "ready");
    controller.timer.state.update((state) => ({ ...state, scramble: "R U" }));
    controller.setArea("statistics");
    const before = controller.snapshot();

    expect(controller.returnToTimerReview()).toBe(false);
    expect(controller.snapshot()).toEqual(before);

    controller.setArea("timer");
    expect(controller.snapshot().area).toBe("timer");
    expect(controller.snapshot().phase).toBe("ready");
    expect(controller.snapshot().scramble).toBe("R U");
  });

  it("keeps virtual practice separate from the physical cube", async () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0);
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;

    const physicalStart = kpuzzle.defaultPattern().applyAlg(new Alg("R U F"));
    const controller = new Controller(new CubeModel(kpuzzle, physicalStart));
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");

    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    expect(controller.training.state.get().phase).toBe("ready");
    expect(controller.training.state.get().setup).toBe("");
    expect(controller.training.state.get().displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );

    const grip = f2lTrainingGrip(target.info);
    const cubeMoves = Array.from(new Alg(BASIC_CASES[0].algorithms.FR[0]).expand().childAlgNodes()).map(
      (node) => reorientMove(node.toString(), invert(grip)),
    );
    const physicalAfter = physicalStart.applyAlg(new Alg(cubeMoves.join(" ")));
    for (const move of cubeMoves) controller.injectMove(move);

    const completedResult = controller.training.state.get().result;
    expect(controller.training.state.get().phase).toBe("ready");
    expect(controller.snapshot().solves).toEqual([]);
    expect(patternToFacelets(controller.pattern!)).toBe(patternToFacelets(physicalAfter));
    expect(controller.training.state.get().displayFacelets).toBe(
      patternToFacelets(buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0], "FR", undefined, 1).pattern),
    );
    expect(completedResult?.moves).toEqual(
      Array.from(new Alg(BASIC_CASES[0].algorithms.FR[0]).expand().childAlgNodes()).map((node) => node.toString()),
    );
    expect(controller.training.state.get().result).toEqual(completedResult);
    expect(controller.training.state.get().liveMoves).toEqual([]);

    controller.injectMove(cubeMoves[0]);
    expect(controller.training.state.get().phase).toBe("solving");
    expect(controller.training.state.get().result).toBeNull();
    expect(controller.training.state.get().liveMoves).toEqual(["U"]);

    const physicalResult = patternToFacelets(controller.pattern!);
    controller.againTraining();
    expect(controller.training.state.get().phase).toBe("ready");
    expect(patternToFacelets(controller.pattern!)).toBe(physicalResult);
    expect(controller.training.state.get().displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );
    expect(controller.training.state.get().result).toBeNull();

    await controller.setTrainingMode("setup");
    expect(controller.training.state.get().mode).toBe("setup");
    expect(controller.state.get().error).toEqual(null);
    expect(["preparing", "ready"]).toContain(controller.training.state.get().phase);
    expect(controller.training.state.get().displayFacelets).toBe(physicalResult);
  });








});

describe("Controller Session event ownership", () => {
  it("changes an empty Session in place and regenerates its scramble", async () => {
    stubPersistence();
    const controller = readyController([session("1")], "1");
    const newScramble = vi.spyOn(controller, "newScramble").mockResolvedValue();

    await controller.changeEvent("222");

    expect(controller.snapshot().sessions).toEqual([
      expect.objectContaining({ id: "1", name: "Session 1", event: "222" }),
    ]);
    expect(db.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", event: "222" }),
    );
    expect(newScramble).toHaveBeenCalledOnce();
  });

  it("regenerates only when selecting a Session with a different event", async () => {
    stubPersistence();
    const different = readyController(
      [session("1", "333"), session("2", "222")],
      "1",
    );
    const differentScramble = vi.spyOn(different, "newScramble").mockResolvedValue();
    await different.selectSession("2");
    expect(differentScramble).toHaveBeenCalledOnce();
    expect(different.snapshot().sessionId).toBe("2");

    stubPersistence();
    const same = readyController(
      [session("1", "333"), session("2", "333")],
      "1",
    );
    const sameScramble = vi.spyOn(same, "newScramble").mockResolvedValue();
    await same.selectSession("2");
    expect(sameScramble).not.toHaveBeenCalled();
  });

  it("uses the selected Session event for smart-cube scramble tracking", () => {
    const smart = readyController([session("1", "333")], "1");
    smart.physical.state.update((state) => ({ ...state, virtualCube: true }));
    smart.setScramble("R U");
    expect(smart.snapshot().scrambleProgress).not.toBeNull();

    const nonSmart = readyController([session("1", "222")], "1");
    nonSmart.physical.state.update((state) => ({ ...state, virtualCube: true }));
    nonSmart.setScramble("R U");
    expect(nonSmart.snapshot().scrambleProgress).toBeNull();
  });

  it.each(["inspection", "solving"] as const)(
    "rejects Session/event changes during %s",
    async (phase) => {
      stubPersistence();
      const sessions = [session("1"), session("2", "222")];
      const controller = readyController(sessions, "1", [solveFor("1")], phase);

      await controller.selectSession("2");
      await controller.createSession("Session 3");
      await controller.changeEvent("222");
      await controller.deleteSession("1");

      expect(controller.snapshot().sessions).toEqual(sessions);
      expect(controller.snapshot().sessionId).toBe("1");
    },
  );

  it("rejects Session context changes and imports during a Training solving attempt", async () => {
    const sessions = [session("1"), session("2", "222")];
    const controller = readyController(sessions, "1");
    controller.training.state.update((state) => ({ ...state, phase: "solving" }));
    controller.state.update((state) => ({ ...state, area: "training" }));
    const before = controller.snapshot();
    await controller.selectSession("2");
    await controller.createSession("Third");
    await controller.changeEvent("222");
    await controller.deleteSession("1");
    await expect(controller.importData("{}")).rejects.toThrow(/Cannot import/);
    await expect(controller.importSolveCsv("")).rejects.toThrow(/Cannot import/);
    expect(controller.snapshot()).toEqual(before);
  });
});

describe("Controller Session-context synchronization", () => {
  it("queues rename after pending selection and persists the completed context", async () => {
    const sessions = [session("1"), session("2")];
    const controller = readyController(sessions, "1");
    const history = deferred<Solve[]>();
    const started = deferred<void>();
    vi.spyOn(db, "loadSolves").mockImplementation(() => {
      started.resolve();
      return history.promise;
    });
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    const selecting = controller.selectSession("2");
    await started.promise;
    const renaming = controller.renameSession("2", "Renamed");
    expect(save).not.toHaveBeenCalled();
    history.resolve([]);
    await Promise.all([selecting, renaming]);
    expect(controller.snapshot().sessionId).toBe("2");
    expect(controller.snapshot().sessions[1]).toEqual({ ...sessions[1], name: "Renamed" });
    expect(save).toHaveBeenCalledExactlyOnceWith(controller.snapshot().sessions[1]);
  });

  it("preserves event and rename in storage when rename follows a pending event write", async () => {
    let stored = session("1");
    const controller = readyController([stored], "1");
    const write = deferred<void>();
    const started = deferred<void>();
    vi.spyOn(db, "saveSession").mockImplementation(async (value) => {
      if (value.event === "222" && value.name === "Session 1") {
        started.resolve();
        await write.promise;
      }
      stored = { ...value };
    });
    vi.spyOn(controller, "newScramble").mockResolvedValue();
    const changing = controller.changeEvent("222");
    await started.promise;
    const renaming = controller.renameSession("1", "Renamed");
    write.resolve();
    await Promise.all([changing, renaming]);
    expect(stored).toMatchObject({ name: "Renamed", event: "222" });
    expect(controller.snapshot().sessions[0]).toEqual(stored);
  });

  it.each(["select", "change", "create", "import"] as const)(
    "locks Timer immediately while %s waits behind rename and reads its completed state",
    async (operation) => {
      stubTimerLoop();
      const sessions = [session("1"), session("2")];
      const storage = new Map(sessions.map((value) => [value.id, value]));
      const controller = readyController(sessions, "1", [], "ready");
      const write = deferred<void>();
      const started = deferred<void>();
      const save = vi.spyOn(db, "saveSession").mockImplementation(async (value) => {
        if (value.name === "Renamed" && value.event === "333") {
          started.resolve();
          await write.promise;
        }
        storage.set(value.id, { ...value });
      });
      vi.spyOn(db, "loadSessions").mockImplementation(async () => [...storage.values()]);
      vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
      vi.spyOn(db, "loadSolves").mockResolvedValue([]);
      vi.spyOn(controller, "newScramble").mockResolvedValue();
      const renaming = controller.renameSession("1", "Renamed");
      await started.promise;
      const changing = operation === "select" ? controller.selectSession("2")
        : operation === "change" ? controller.changeEvent("222")
          : operation === "create" ? controller.createSession("Third")
            : controller.importData(JSON.stringify({ format: "cubetimer", version: 2, sessions: [session("2")], solves: [] }));
      controller.startFromKeyboard();
      expect(controller.snapshot().phase).toBe("ready");
      expect(save).toHaveBeenCalledTimes(1);
      write.resolve();
      await Promise.all([renaming, changing]);
      expect(controller.snapshot().sessions.find((value) => value.id === "1")).toEqual(storage.get("1"));
      expect(storage.get("1")).toMatchObject({ name: "Renamed", event: operation === "change" ? "222" : "333" });
      expect(controller.snapshot().sessionId).toBe(operation === "select" ? "2"
        : operation === "create" ? controller.snapshot().sessions.at(-1)!.id : "1");
    },
  );

  it.each(["ready", "inspection", "solving"] as const)("rename stays metadata-only during Timer %s", async (phase) => {
    stubTimerLoop();
    const write = deferred<void>();
    const started = deferred<void>();
    vi.spyOn(db, "saveSession").mockImplementation(() => {
      started.resolve();
      return write.promise;
    });
    const controller = readyController([session("1")], "1", [], phase);
    const scramble = vi.spyOn(controller, "newScramble").mockResolvedValue();
    const renaming = controller.renameSession("1", "Renamed");
    await started.promise;
    if (phase !== "solving") controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("solving");
    write.resolve();
    await renaming;
    expect(controller.snapshot().sessions[0].name).toBe("Renamed");
    expect(scramble).not.toHaveBeenCalled();
  });

  it("allows rename during a Training attempt", async () => {
    vi.spyOn(db, "saveSession").mockResolvedValue();
    const controller = readyController([session("1")], "1");
    controller.training.state.update((state) => ({ ...state, phase: "solving" }));
    controller.state.update((state) => ({ ...state, area: "training" }));
    await controller.renameSession("1", "Renamed");
    expect(controller.training.state.get().phase).toBe("solving");
    expect(controller.snapshot().sessions[0].name).toBe("Renamed");
  });

  it("executes queued mutations after a persistence rejection", async () => {
    const save = vi.spyOn(db, "saveSession").mockRejectedValueOnce(new Error("write failed")).mockResolvedValue();
    const controller = readyController([session("1")], "1");
    const failing = controller.renameSession("1", "Failed");
    const succeeding = controller.renameSession("1", "Succeeded");
    await expect(failing).rejects.toThrow("write failed");
    await succeeding;
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().sessions[0].name).toBe("Succeeded");
  });

  it("does not start a solve while Session selection is awaiting persistence", async () => {
    stubTimerLoop();
    vi.spyOn(db, "saveSession").mockResolvedValue();
    vi.spyOn(db, "deleteSession").mockResolvedValue();
    const loading = deferred<Solve[]>();
    vi.spyOn(db, "loadSolves").mockImplementation((id) =>
      id === "2" ? loading.promise : Promise.resolve([]),
    );
    const controller = readyController(
      [session("1", "333"), session("2", "222")],
      "1",
      [],
      "ready",
    );
    vi.spyOn(controller, "newScramble").mockResolvedValue();

    const selecting = controller.selectSession("2");
    controller.startFromKeyboard();

    expect(controller.snapshot().phase).toBe("ready");
    loading.resolve([]);
    await selecting;
    expect(controller.snapshot().sessionId).toBe("2");

    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("solving");
  });

  it("does not start a solve while an empty Session event change is pending", async () => {
    stubTimerLoop();
    const saving = deferred<void>();
    vi.spyOn(db, "saveSession").mockReturnValue(saving.promise);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "deleteSession").mockResolvedValue();
    const controller = readyController([session("1")], "1", [], "ready");
    const newScramble = vi.spyOn(controller, "newScramble").mockResolvedValue();

    const changing = controller.changeEvent("222");
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("ready");

    saving.resolve();
    await changing;
    expect(controller.snapshot().sessions[0].event).toBe("222");
    expect(newScramble).toHaveBeenCalledOnce();
  });

  it("does not start a solve while the active Session is being deleted", async () => {
    stubTimerLoop();
    const deleting = deferred<void>();
    vi.spyOn(db, "deleteSession").mockReturnValue(deleting.promise);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveSession").mockResolvedValue();
    const controller = readyController(
      [session("1"), session("2")],
      "1",
      [],
      "ready",
    );
    vi.spyOn(controller, "newScramble").mockResolvedValue();

    const deletingSession = controller.deleteSession("1");
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("ready");

    deleting.resolve();
    await deletingSession;
    expect(controller.snapshot().sessionId).toBe("2");
    expect(controller.snapshot().solves).toEqual([]);
  });

  it("ignores an overlapping Session selection instead of allowing stale completion", async () => {
    const loading = deferred<Solve[]>();
    vi.spyOn(db, "loadSolves").mockImplementation((id) =>
      id === "2" ? loading.promise : Promise.resolve([]),
    );
    vi.spyOn(db, "saveSession").mockResolvedValue();
    vi.spyOn(db, "deleteSession").mockResolvedValue();
    const controller = readyController(
      [session("1"), session("2"), session("3")],
      "1",
    );

    const first = controller.selectSession("2");
    await controller.selectSession("3");
    expect(controller.snapshot().sessionId).toBe("1");
    expect(db.loadSolves).toHaveBeenCalledTimes(1);

    loading.resolve([]);
    await first;
    expect(controller.snapshot().sessionId).toBe("2");
  });
});

describe("Controller import runtime integration", () => {
  function jsonExport(sessions: Session[], solves: Solve[] = []): string {
    return JSON.stringify({ format: "cubetimer", version: 2, sessions, solves });
  }

  it.each(["json", "csv"] as const)("queues rename through %s import context reload and scramble consequences", async (format) => {
    let stored = session("import:Imported");
    const controller = readyController([stored], stored.id);
    const imported = { ...stored, name: "Imported", event: format === "json" ? "222" as const : "333" as const };
    const write = deferred<void>();
    const started = deferred<void>();
    vi.spyOn(db, "loadSessions").mockImplementation(async () => [{ ...stored }]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveSolve").mockResolvedValue();
    const save = vi.spyOn(db, "saveSession").mockImplementation(async (value) => {
      if (value.name === "Imported") {
        started.resolve();
        await write.promise;
      }
      stored = { ...value };
    });
    vi.spyOn(controller, "newScramble").mockResolvedValue();
    const importing = format === "json" ? controller.importData(jsonExport([imported]))
      : controller.importSolveCsv(formatSolveCsv([solveFor(imported.id)], new Map([[imported.id, imported.name]])));
    await started.promise;
    const renaming = controller.renameSession(imported.id, "Renamed");
    expect(save).toHaveBeenCalledTimes(1);
    write.resolve();
    await Promise.all([importing, renaming]);
    expect(stored).toMatchObject({ name: "Renamed", event: imported.event });
    expect(controller.snapshot().sessions[0]).toEqual(stored);
  });

  it("updates an empty imported Session event and refreshes the selected scramble", async () => {
    const before = session("A", "333");
    const after = { ...before, event: "222" as const };
    vi.spyOn(db, "loadSessions")
      .mockResolvedValueOnce([before])
      .mockResolvedValueOnce([after]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveSession").mockResolvedValue();
    const controller = readyController([before], before.id, [], "ready");
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setScramble("R U");
    expect(controller.snapshot().scrambleProgress).not.toBeNull();
    controller.timer.state.update((state) => ({ ...state, scrambleGeneration: { kind: "cross" } }));
    const newScramble = vi.spyOn(controller, "newScramble").mockResolvedValue();

    await controller.importData(jsonExport([after]));

    expect(controller.snapshot().sessions).toEqual([after]);
    expect(controller.snapshot()).toMatchObject({
      scrambleProgress: null, scrambleGeneration: null, recovery: null,
    });
    expect(newScramble).toHaveBeenCalledOnce();
    // The old 333 tracker must also be gone after applying the persisted result.
    controller.injectMove("R");
    expect(controller.snapshot().scrambleProgress).toBeNull();
  });

  it("reconciles a same-event import without regenerating the current scramble", async () => {
    const local = session("A");
    const historical = solveFor(local.id);
    vi.spyOn(db, "loadSessions").mockResolvedValue([local]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([historical]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([historical]);
    vi.spyOn(db, "saveSession").mockResolvedValue();
    const controller = readyController([local], local.id);
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setScramble("R U");
    const newScramble = vi.spyOn(controller, "newScramble").mockResolvedValue();
    await controller.importData(jsonExport([local]));
    expect(newScramble).not.toHaveBeenCalled();
    expect(controller.snapshot().solves).toEqual([historical]);
    expect(controller.snapshot().lastSolve).toBe(historical);
    expect(controller.snapshot().scramble).toBe("R U");
    controller.injectMove("R");
    expect(controller.snapshot().scrambleProgress?.index).toBe(1);
  });

  it("keeps the JSON import lock through history reload and scramble regeneration, then releases it", async () => {
    stubTimerLoop();
    const before = session("A");
    const after = { ...before, event: "222" as const };
    vi.spyOn(db, "loadSessions").mockResolvedValueOnce([before]).mockResolvedValueOnce([after]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveSession").mockResolvedValue();
    const historyStarted = deferred<void>();
    const history = deferred<Solve[]>();
    vi.spyOn(db, "loadSolves").mockImplementation(() => {
      historyStarted.resolve();
      return history.promise;
    });
    const scrambleStarted = deferred<void>();
    const scramble = deferred<void>();
    const controller = readyController([before], before.id, [], "ready");
    vi.spyOn(controller, "newScramble").mockImplementation(() => {
      scrambleStarted.resolve();
      return scramble.promise;
    });
    const importing = controller.importData(jsonExport([after]));
    await historyStarted.promise;
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("ready");
    await expect(controller.importSolveCsv("")).rejects.toThrow(/Cannot import/);
    history.resolve([]);
    await scrambleStarted.promise;
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("ready");
    scramble.resolve();
    await importing;
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("solving");
  });

  it("releases the import lock after an import failure", async () => {
    stubTimerLoop();
    const controller = readyController([session("A")], "A", [], "ready");
    await expect(controller.importData("{invalid")).rejects.toBeInstanceOf(SyntaxError);
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("solving");
  });

  it("holds the Session lock for a pending JSON import", async () => {
    stubTimerLoop();
    const saving = deferred<void>();
    const local = session("A");
    const imported = { ...local, id: "B", name: "Session B" };
    vi.spyOn(db, "loadSessions")
      .mockResolvedValueOnce([local])
      .mockResolvedValueOnce([local, imported]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveSession").mockReturnValue(saving.promise);
    const controller = readyController([local], local.id, [], "ready");
    vi.spyOn(controller, "newScramble").mockResolvedValue();

    const importing = controller.importData(jsonExport([imported]));
    controller.startFromKeyboard();
    expect(controller.snapshot().phase).toBe("ready");

    saving.resolve();
    await importing;
  });

  it("holds the Session lock for a pending CSV import", async () => {
    stubTimerLoop();
    const saving = deferred<void>();
    const local = session("A");
    const imported: Session = {
      id: "import:Imported",
      name: "Imported",
      event: DEFAULT_EVENT_ID,
      createdAt: 0,
    };
    const csv = formatSolveCsv(
      [solveFor(imported.id)],
      new Map([[imported.id, imported.name]]),
    );
    vi.spyOn(db, "loadSessions")
      .mockResolvedValueOnce([local])
      .mockResolvedValueOnce([local, imported]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveSession").mockReturnValue(saving.promise);
    vi.spyOn(db, "saveSolve").mockResolvedValue();
    const controller = readyController([local], local.id, [], "ready");

    const importing = controller.importSolveCsv(csv);
    controller.startFromKeyboard();
    controller.injectMove("R");
    expect(controller.snapshot().phase).toBe("ready");

    saving.resolve();
    await importing;
  });

  it.each(["inspection", "solving"] as const)(
    "rejects JSON and CSV imports during %s",
    async (phase) => {
      const controller = readyController([session("A")], "A", [], phase);
      const csv = formatSolveCsv(
        [solveFor("import:Imported")],
        new Map([["import:Imported", "Imported"]]),
      );

      await expect(controller.importData(jsonExport([session("B")]))).rejects.toThrow(
        /Cannot import/,
      );
      await expect(controller.importSolveCsv(csv)).rejects.toThrow(/Cannot import/);
    },
  );

});

describe("Controller Training composition", () => {
  it("publishes Training turns without application-root state notifications", async () => {
    stubTimerLoop();
    const controller = readyController([session("1")], "1");
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    const rootChanged = vi.fn();
    const trainingChanged = vi.fn();
    controller.state.subscribe(rootChanged);
    controller.training.state.subscribe(trainingChanged);
    const physical = controller.pattern!;
    controller.injectMove("R");
    expect(trainingChanged).toHaveBeenCalled();
    expect(rootChanged).not.toHaveBeenCalled();
    expect(controller.pattern!.isIdentical(physical.applyMove("R"))).toBe(true);
    expect(controller.training.state.get().phase).toBe("solving");
    expect(controller.snapshot().solves).toEqual([]);
  });

  it("uses the shared RAF to publish elapsed from the Training timestamp", async () => {
    let tick: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = (callback) => { tick = callback; return 1; };
    globalThis.cancelAnimationFrame = vi.fn();
    const controller = readyController([session("1")], "1");
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    controller.injectMove("R");
    expect(tick).toBeDefined();
    now.mockReturnValue(1250);
    tick!(1250);
    expect(controller.elapsed.get()).toBe(250);
    controller.resetTraining();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    expect(controller.training.elapsedAt(1250)).toBeNull();
  });
});


describe("Controller store ownership", () => {
  it("publishes Timer moves only to the physical and Timer subscribers", () => {
    stubTimerLoop();
    const controller = readyController([session("1")], "1");
    controller.setVirtualCube(true); controller.setScramble("R U");
    const app = vi.fn(), sessions = vi.fn(), settings = vi.fn(), cube = vi.fn(), timer = vi.fn(), training = vi.fn();
    controller.state.subscribe(app); controller.sessions.subscribe(sessions); controller.settings.subscribe(settings);
    controller.physical.state.subscribe(cube); controller.timer.state.subscribe(timer); controller.training.state.subscribe(training);
    controller.injectMove("R"); controller.injectMove("U"); controller.injectMove("U'");
    expect(cube).toHaveBeenCalled(); expect(timer).toHaveBeenCalled();
    expect(app).not.toHaveBeenCalled(); expect(sessions).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled(); expect(training).not.toHaveBeenCalled();
    expect(controller.state.get()).toEqual({ ready: true, area: "timer", error: null });
  });
});

const persistedTrainingAttempt = (): TrainingAttempt => ({
  id: "training-history", createdAt: 10, mode: "virtual", activity: "single", drillRunId: null, drillRound: null, caseTimeMs: null,
  target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 4", position: "FR" },
  moves: ["R"], stm: 1, elapsedMs: 800, recommendedStm: 1, matchedReferenceRank: 1, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: 0,
});
async function completeControllerTraining() {
  stubTimerLoop();
  const controller = readyController([session("1"), session("2")], "1");
  controller.setArea("training"); await controller.setTrainingMode("virtual");
  await controller.selectF2lCase("F2L 4");
  const target = controller.training.state.get().target!;
  for (const move of referenceExecutionSignature(target.references[0].alg)!) controller.injectMove(cubeMove(move, trainingGrip(target)));
  return controller;
}

describe("Controller Training history composition", () => {
  it("loads global history during init into its own Store", async () => {
    const attempt = persistedTrainingAttempt();
    vi.spyOn(db, "loadTrainingAttempts").mockResolvedValue([attempt]);
    vi.spyOn(db, "loadSettings").mockResolvedValue(DEFAULT_SETTINGS);
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(CubeModel, "create").mockResolvedValue(new CubeModel(kpuzzle));
    const controller = new Controller(); vi.spyOn(controller, "newScramble").mockResolvedValue();
    await controller.init();
    expect(controller.trainingAttempts.get()).toEqual([attempt]);
    expect(controller.state.get().ready).toBe(true);
    expect(controller.sessions.get()).not.toHaveProperty("trainingAttempts");
    expect(controller.training.state.get()).not.toHaveProperty("trainingAttempts");
    expect(controller.snapshot().solves).toEqual([]);
  });

  it("publishes completion immediately, saves once, and waits for the write before JSON backup", async () => {
    const writing = deferred<void>();
    const save = vi.spyOn(db, "saveTrainingAttempt").mockReturnValue(writing.promise);
    const saveSolve = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const controller = await completeControllerTraining();
    const [attempt] = controller.trainingAttempts.get();
    const result = controller.training.state.get().result;
    expect(attempt).toMatchObject({ mode: "virtual", target: { family: "f2l", origin: "catalog", caseName: "F2L 4" }, moves: result!.moves });
    expect(save).toHaveBeenCalledExactlyOnceWith(attempt);
    expect(saveSolve).not.toHaveBeenCalled();
    expect(controller.sessions.get().solves).toEqual([]);
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    const load = vi.spyOn(db, "loadTrainingAttempts").mockResolvedValue([attempt]);
    const exporting = controller.exportData();
    await Promise.resolve(); expect(load).not.toHaveBeenCalled();
    writing.resolve();
    expect(JSON.parse(await exporting).trainingAttempts).toEqual([attempt]);
    controller.againTraining(); await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
  });

  it("reports write failure without discarding the result or in-memory history", async () => {
    vi.spyOn(db, "saveTrainingAttempt").mockRejectedValue(new Error("quota exceeded"));
    const controller = await completeControllerTraining();
    const result = controller.training.state.get().result;
    await vi.waitFor(() => expect(controller.state.get().error).toContain("quota exceeded"));
    expect(controller.training.state.get().result).toBe(result);
    expect(result).not.toBeNull();
    expect(controller.trainingAttempts.get()).toHaveLength(1);
    expect(controller.sessions.get().solves).toEqual([]);
  });

  it("does not replace global Training history when Timer Sessions change", async () => {
    const controller = readyController([session("1"), session("2")], "1");
    const attempts = [persistedTrainingAttempt()]; controller.trainingAttempts.set(attempts);
    stubPersistence(); vi.spyOn(controller, "newScramble").mockResolvedValue();
    await controller.selectSession("2");
    expect(controller.trainingAttempts.get()).toBe(attempts);
    expect(controller.sessions.get().sessionId).toBe("2");
  });

  it("F2L review delegates to selection while retaining library, position and mode", async () => {
    const controller = new Controller(new CubeModel(kpuzzle)); controller.setArea("training");
    controller.setF2lLibrary("advanced"); await controller.selectF2lPosition("FL");
    await controller.setTrainingMode("virtual");
    const select = vi.spyOn(controller.training, "selectF2lCase").mockResolvedValue();
    vi.spyOn(Math, "random").mockReturnValue(0);
    await controller.reviewTrainingCase("f2l");
    expect(select).toHaveBeenCalledExactlyOnceWith(F2L_TRAINING_CATALOGUES.advanced.cases[0].name);
    expect(controller.training.state.get()).toMatchObject({ mode: "virtual", f2lSelection: { library: "advanced", position: "FL" } });
  });

  it.each(["oll", "pll"] as const)("%s review delegates to the selected Full/2-Look set", async family => {
    const controller = new Controller(new CubeModel(kpuzzle)); controller.setArea("training");
    const select = vi.spyOn(controller.training, "selectLastLayerCase").mockResolvedValue();
    vi.spyOn(Math, "random").mockReturnValue(0);
    for (const set of ["full", "2look"] as const) {
      controller.settings.set({ ...controller.settings.get(), [family === "oll" ? "ollTrainingSet" : "pllTrainingSet"]: set });
      await controller.reviewTrainingCase(family);
      expect(select).toHaveBeenLastCalledWith(family, lastLayerCaseIds(family, set)[0], set);
    }
  });

  it("JSON import refreshes the history Store and returns Training counts independently of Sessions", async () => {
    const controller = readyController([session("1")], "1");
    const attempt = persistedTrainingAttempt();
    let stored: TrainingAttempt[] = [];
    vi.spyOn(db, "saveTrainingAttempt").mockImplementation(async row => { stored = [row]; });
    vi.spyOn(db, "loadTrainingAttempts").mockImplementation(async () => stored);
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([]); vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const result = await controller.importData(JSON.stringify({ version: 3, sessions: [], solves: [], trainingAttempts: [attempt] }));
    expect(result).toEqual({ sessions: 0, solves: 0, trainingAttempts: 1, trainingRecognitionAttempts: 0, trainingDrillPresets: 0, trainingAlgorithmPreferences: 0 });
    expect(controller.trainingAttempts.get()).toEqual([attempt]);
    expect(controller.sessions.get().sessionId).toBe("1");
  });
});

describe("Controller Drill composition", () => {
  function running() {
    let now = 100;
    let frame: FrameRequestCallback | undefined;
    const raf = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = vi.fn(() => { frame = undefined; });
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const controller = readyController([session("1"), session("2")], "1");
    controller.setArea("training"); controller.setTrainingActivity("drill");
    controller.setDrillCases(["F2L 4", "F2L 5"]); controller.setDrillStrategy("weighted"); controller.startTrainingDrill();
    const advance = (ms: number) => { now += ms; const next = frame; frame = undefined; next?.(now); };
    const solve = () => {
      const target = controller.training.state.get().target!;
      for (const token of referenceExecutionSignature(target.references[0].alg)!) {
        now += 100; controller.injectMove(cubeMove(token, trainingGrip(target)));
      }
    };
    return { controller, advance, solve, raf, hasFrame: () => frame !== undefined };
  }
  it("stops scheduling during recognition and restarts on turns without losing the waiting time", () => {
    const { controller, advance, solve, raf, hasFrame } = running();
    expect(hasFrame()).toBe(true); advance(2000); expect(hasFrame()).toBe(false);
    const count = raf.mock.calls.length; advance(1500); expect(raf).toHaveBeenCalledTimes(count);
    controller.injectMove("B"); expect(hasFrame()).toBe(true);
    controller.injectMove("B'"); solve();
    expect(controller.trainingAttempts.get()[0].caseTimeMs).toBeGreaterThan(1500);
    expect(hasFrame()).toBe(true); advance(2000); expect(hasFrame()).toBe(false);
    controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    expect(controller.training.state.get().drill.status).toBe("summary");
    controller.finishTrainingDrillSummary(true);
    expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", running: false, strategy: "weighted" });
    expect(hasFrame()).toBe(false);
  });
  it("uses the existing RAF for countdown and gives each weighted draw the latest immediately appended history", async () => {
    const select = vi.spyOn(drillPolicy, "selectDrillCase");
    const { controller, advance, solve } = running();
    const countdown = vi.fn(), aggregate = vi.fn();
    controller.training.drillCountdown.subscribe(countdown); controller.training.state.subscribe(aggregate);
    advance(500); expect(controller.training.drillCountdown.get()).toBe(1500);
    expect(countdown).toHaveBeenCalled(); expect(aggregate).not.toHaveBeenCalled();
    advance(1500); expect(select).toHaveBeenCalledOnce(); expect(select.mock.calls[0][4]).toEqual([]);
    advance(500); solve();
    const history = controller.trainingAttempts.get();
    expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ activity: "drill", mode: "virtual" });
    expect(history[0].caseTimeMs).toBeGreaterThan(500); expect(db.saveTrainingAttempt).toHaveBeenCalledOnce();
    const saved = vi.spyOn(db, "saveSolve"); expect(saved).not.toHaveBeenCalled();
    advance(2000); expect(select).toHaveBeenCalledTimes(2); expect(select.mock.calls[1][4]).toBe(history);
    expect(select.mock.calls[1][6]).toEqual(controller.training.state.get().drill.outcomes);
    expect(controller.training.state.get().drill.lastCaseId).toBe("F2L 5");
    controller.stopTrainingDrill(); expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
  });
  it.each(["initial", "ready", "solving", "result", "skipped"])("prevents Statistics during %s Drill and cancels it when leaving for Timer", stage => {
    const { controller, advance, solve } = running();
    if (stage !== "initial") advance(2000);
    if (stage === "solving") controller.injectMove("B");
    if (stage === "result") solve();
    if (stage === "skipped") controller.skipTrainingDrillCase();
    controller.setArea("statistics"); expect(controller.state.get().area).toBe("training");
    const history = controller.trainingAttempts.get();
    vi.spyOn(controller.timer, "useCubeStateAsScramble").mockResolvedValue("applied");
    controller.setArea("timer");
    expect(controller.training.state.get()).toMatchObject({ target: null, result: null, drill: { running: false, status: "configuring", outcomes: [] } });
    expect(controller.training.drillCountdown.get()).toBeNull(); expect(controller.trainingAttempts.get()).toBe(history);
  });
  it.each(["oll", "pll"] as const)("set changes cancel %s Drill during initial countdown and clear Full IDs", async family => {
    const { controller } = running(); controller.setTrainingFamily(family);
    controller.setDrillCases([family === "oll" ? "27" : "T"]); controller.startTrainingDrill();
    vi.spyOn(db, "saveSettings").mockResolvedValue();
    await controller.updateSettings(family === "oll" ? { ollTrainingSet: "2look" } : { pllTrainingSet: "2look" });
    expect(controller.training.state.get()).toMatchObject({ activity: "drill", family, target: null, drill: { running: false, selectedCaseIds: [] } });
  });
  it("discards completed Drill summaries on top-level Statistics navigation while retaining configuration", () => {
    const { controller, advance } = running(); advance(2000);
    controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    expect(controller.training.state.get().drill.status).toBe("summary");
    controller.setArea("statistics"); expect(controller.state.get().area).toBe("statistics");
    expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", outcomes: [], selectedCaseIds: ["F2L 4", "F2L 5"], strategy: "weighted" });
    controller.setArea("training"); expect(controller.training.state.get().drill.running).toBe(false);
  });
  it("Session switching leaves Drill configuration and global history independent", async () => {
    const { controller } = running(); controller.stopTrainingDrill();
    const drill = controller.training.state.get().drill;
    const history = [persistedTrainingAttempt()]; controller.trainingAttempts.set(history);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    await controller.selectSession("2");
    expect(controller.training.state.get().drill).toBe(drill); expect(controller.trainingAttempts.get()).toBe(history);
    expect(controller.sessions.get().sessionId).toBe("2");
  });
});

const savedDrill = (values: Partial<TrainingDrillPreset> = {}): TrainingDrillPreset => ({
  id: "preset", name: "Cases", createdAt: 10, updatedAt: 20, context: { family: "f2l", library: "basic", position: "FR" },
  caseIds: ["F2L 4", "F2L 5"], task: "execution", strategy: "weighted", ...values,
});
function presetController() {
  stubTimerLoop();
  const controller = readyController([session("1")], "1");
  controller.setTrainingActivity("drill"); controller.setDrillCases(["F2L 4", "F2L 5"]);
  return controller;
}

describe("Controller Saved Drill composition", () => {
  it("initializes a separate Store without polluting runtime or Session state", async () => {
    const preset = savedDrill();
    vi.mocked(db.loadTrainingDrillPresets).mockResolvedValue([preset]);
    vi.spyOn(db, "loadSettings").mockResolvedValue({ ...DEFAULT_SETTINGS });
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const controller = new Controller(); vi.spyOn(controller, "newScramble").mockResolvedValue();
    await controller.init();
    expect(controller.trainingDrillPresets.get()).toEqual([preset]);
    expect(JSON.stringify(controller.training.state.get())).not.toContain('"preset"');
    expect(JSON.stringify(controller.sessions.get())).not.toContain('"preset"');
    expect(controller.state.get()).not.toHaveProperty("trainingDrillPresets");
  });
  it("persists before publication and snapshots only current configuration", async () => {
    const controller = presetController(); const pending = deferred<void>();
    vi.spyOn(db, "saveTrainingDrillPreset").mockReturnValue(pending.promise);
    const saving = controller.createTrainingDrillPreset("  New  ");
    await Promise.resolve();
    expect(controller.trainingDrillPresets.get()).toEqual([]);
    controller.setDrillCases(["F2L 6"]);
    pending.resolve(); expect(await saving).toBe(true);
    const preset = controller.trainingDrillPresets.get()[0];
    expect(preset).toMatchObject({ name: "New", context: { family: "f2l", library: "basic", position: "FR" }, caseIds: ["F2L 4", "F2L 5"] });
    expect(preset).not.toHaveProperty("outcomes"); expect(preset).not.toHaveProperty("running");
  });
  it("does not create empty selections and reports failed persistence without phantom records", async () => {
    const controller = presetController(); const original = [savedDrill()]; controller.trainingDrillPresets.set(original);
    vi.spyOn(db, "saveTrainingDrillPreset").mockRejectedValue(new Error("storage failed"));
    controller.setDrillCases([]); expect(await controller.createTrainingDrillPreset("Empty")).toBe(false);
    expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled();
    controller.setDrillCases(["F2L 4"]); expect(await controller.createTrainingDrillPreset("New")).toBe(false);
    expect(controller.trainingDrillPresets.get()).toBe(original); expect(controller.state.get().error).toContain("storage failed");
  });
  it("renames independently, explicitly updates latest configuration and deletes without changing it", async () => {
    const controller = presetController(); const preset = savedDrill(); controller.trainingDrillPresets.set([preset]);
    vi.spyOn(Date, "now").mockReturnValue(100);
    vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue(); vi.spyOn(db, "deleteTrainingDrillPreset").mockResolvedValue();
    expect(await controller.renameTrainingDrillPreset(preset.id, " Renamed ")).toBe(true);
    expect(controller.trainingDrillPresets.get()).toEqual([{ ...preset, name: "Renamed", updatedAt: 100 }]);
    controller.setDrillCases(["F2L 6"]); controller.setDrillStrategy("random");
    expect(controller.trainingDrillPresets.get()[0].caseIds).toEqual(preset.caseIds);
    vi.mocked(Date.now).mockReturnValue(200);
    expect(await controller.updateTrainingDrillPreset(preset.id)).toBe(true);
    expect(controller.trainingDrillPresets.get()).toEqual([{ ...preset, name: "Renamed", updatedAt: 200, caseIds: ["F2L 6"], strategy: "random" }]);
    const before = controller.training.state.get(); const sessions = controller.sessions.get();
    expect(await controller.deleteTrainingDrillPreset(preset.id)).toBe(true);
    expect(db.deleteTrainingDrillPreset).toHaveBeenCalledWith(preset.id);
    expect(controller.trainingDrillPresets.get()).toEqual([]); expect(controller.training.state.get()).toBe(before);
    expect(controller.sessions.get()).toBe(sessions);
  });
  it.each(["basic", "advanced"] as const)("restores complete %s F2L from another family, without target or countdown", async library => {
    const controller = presetController(); controller.setTrainingFamily("pll");
    const caseIds = F2L_TRAINING_CATALOGUES[library].cases.slice(0, 2).map(c => c.name);
    const preset = savedDrill({ context: { family: "f2l", library, position: "BL" }, caseIds, strategy: "sequence" });
    controller.trainingDrillPresets.set([preset]);
    const physical = controller.pattern;
    expect(await controller.applyTrainingDrillPreset(preset.id)).toBe(true);
    expect(controller.training.state.get()).toMatchObject({ family: "f2l", activity: "drill", mode: "virtual", phase: "selecting", target: null,
      f2lSelection: { library, position: "BL" }, drill: { status: "configuring", running: false, selectedCaseIds: caseIds, task: "execution", strategy: "sequence", round: 0 } });
    expect(controller.training.drillCountdown.get()).toBeNull(); expect(controller.pattern).toBe(physical);
    expect(controller.trainingDrillPresets.get()[0]).toBe(preset);
    controller.startTrainingDrill(); expect(controller.training.drillCountdown.get()).toBe(2000);
  });
  it.each(["oll", "pll"] as const)("restores %s Full/2-Look and persists only that family's Settings preference", async family => {
    const controller = readyController([session("1")], "1");
    vi.spyOn(db, "saveSettings").mockResolvedValue();
    for (const trainingSet of ["2look", "full"] as const) {
      const ids = lastLayerCaseIds(family, trainingSet).slice(0, 2);
      const preset = savedDrill({ context: { family, trainingSet }, caseIds: ids, strategy: "random" });
      controller.trainingDrillPresets.set([preset]);
      expect(await controller.applyTrainingDrillPreset(preset.id)).toBe(true);
      expect(controller.state.get().area).toBe("training");
      expect(controller.training.state.get()).toMatchObject({ family, activity: "drill", target: null,
        drill: { status: "configuring", running: false, selectedCaseIds: ids, strategy: "random" } });
      const key = family === "oll" ? "ollTrainingSet" : "pllTrainingSet";
      const other = family === "oll" ? "pllTrainingSet" : "ollTrainingSet";
      expect(controller.settings.get()[key]).toBe(trainingSet); expect(controller.settings.get()[other]).toBe("full");
      expect(db.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: trainingSet, [other]: "full" }));
      expect(controller.training.drillCountdown.get()).toBeNull();
    }
  });
  it.each(["running", "summary"] as const)("refuses create/update/load during %s without modifying run or saved data", async status => {
    const controller = presetController(); const preset = savedDrill(); controller.trainingDrillPresets.set([preset]);
    controller.training.state.update(s => ({ ...s, drill: { ...s.drill, status, running: status === "running" } }));
    const before = controller.training.state.get(); const settings = controller.settings.get();
    vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue();
    expect(await controller.applyTrainingDrillPreset(preset.id)).toBe(false);
    expect(await controller.updateTrainingDrillPreset(preset.id)).toBe(false);
    expect(await controller.createTrainingDrillPreset("New")).toBe(false);
    expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled(); expect(controller.training.state.get()).toBe(before); expect(controller.settings.get()).toBe(settings);
  });
  it("refreshes imported presets and returns their count", async () => {
    const controller = presetController(); const preset = savedDrill();
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]); vi.spyOn(db, "loadAllSolves").mockResolvedValue([]); vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    vi.spyOn(db, "saveTrainingDrillPreset").mockImplementation(async () => { vi.mocked(db.loadTrainingDrillPresets).mockResolvedValue([preset]); });
    expect(await controller.importData(JSON.stringify({ version: 5, sessions: [], solves: [], trainingDrillPresets: [preset] })))
      .toEqual({ sessions: 0, solves: 0, trainingAttempts: 0, trainingRecognitionAttempts: 0, trainingDrillPresets: 1, trainingAlgorithmPreferences: 0 });
    expect(controller.trainingDrillPresets.get()).toEqual([preset]);
  });
});

describe("Saved Drill atomic application", () => {
  it.each(["oll", "pll"] as const)("failed %s Settings write preserves the exact live configuration", async family => {
    const controller = presetController(); controller.setTrainingFamily(family); controller.setTrainingActivity("drill");
    controller.setDrillCases(lastLayerCaseIds(family, "full").slice(0, 3));
    const preset = savedDrill({ task: "recognition", context: { family, trainingSet: "2look" }, caseIds: lastLayerCaseIds(family, "2look").slice(0, 2) });
    controller.trainingDrillPresets.set([preset]);
    const settings = controller.settings.get(), runtime = controller.training.state.get();
    vi.spyOn(db, "saveSettings").mockRejectedValue(new Error("settings disk failure"));
    expect(await controller.applyTrainingDrillPreset(preset.id)).toBe(false);
    expect(controller.settings.get()).toBe(settings); expect(controller.training.state.get()).toBe(runtime);
    expect(controller.training.drillCountdown.get()).toBeNull(); expect(controller.state.get().error).toContain("settings disk failure");
    expect(controller.trainingDrillConfigurationApplying.get()).toBe(false);
  });
  it("blocks Start while a Settings write is pending and publishes only after success", async () => {
    const controller = presetController(); controller.setTrainingFamily("pll"); controller.setTrainingActivity("drill"); controller.setDrillCases(["T"]);
    const preset = savedDrill({ task: "recognition", context: { family: "pll", trainingSet: "2look" }, caseIds: ["Headlights", "Diagonal"] }); controller.trainingDrillPresets.set([preset]);
    const settings = controller.settings.get(), runtime = controller.training.state.get();
    const pending = deferred<void>(); vi.spyOn(db, "saveSettings").mockReturnValue(pending.promise);
    const loading = controller.applyTrainingDrillPreset(preset.id);
    expect(controller.trainingDrillConfigurationApplying.get()).toBe(true);
    controller.startTrainingDrill(); expect(controller.training.state.get()).toBe(runtime); expect(controller.settings.get()).toBe(settings);
    pending.resolve(); expect(await loading).toBe(true); expect(controller.trainingDrillConfigurationApplying.get()).toBe(false);
    expect(controller.settings.get().pllTrainingSet).toBe("2look");
    expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", running: false, task: "recognition", selectedCaseIds: ["Diagonal", "Headlights"] });
    expect(controller.training.drillCountdown.get()).toBeNull();
    controller.startTrainingDrill(); expect(controller.training.state.get().drill.running).toBe(true);
  });
  it("avoids Settings writes for F2L and same-set last-layer loads", async () => {
    const controller = presetController(); vi.spyOn(db, "saveSettings").mockResolvedValue();
    for (const preset of [savedDrill(), savedDrill({ context: { family: "pll", trainingSet: "full" }, caseIds: ["T"] })]) {
      controller.trainingDrillPresets.set([preset]); expect(await controller.applyTrainingDrillPreset(preset.id)).toBe(true);
    }
    expect(db.saveSettings).not.toHaveBeenCalled();
  });
});

describe("Guided ordinary Drill application", () => {
  const block = (overrides: Partial<TrainingPlanBlock> = {}): TrainingPlanBlock => ({ id: "guided", label: "Learn", reason: "Active cohort",
    context: { family: "f2l", library: "advanced", position: "BL" }, caseIds: ["AF2L 4", "AF2L 5"], task: "recognition", strategy: "sequence", ...overrides });
  it("loads F2L without Settings, saved records, target or countdown", async () => {
    const controller = presetController(), presets = [savedDrill()]; controller.trainingDrillPresets.set(presets);
    const physical = controller.pattern;
    vi.spyOn(db, "saveSettings").mockResolvedValue(); vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue();
    expect(await controller.applyGuidedTrainingBlock(block())).toBe(true);
    expect(controller.training.state.get()).toMatchObject({ family: "f2l", f2lSelection: { library: "advanced", position: "BL" }, activity: "drill", target: null,
      drill: { selectedCaseIds: ["AF2L 4", "AF2L 5"], task: "recognition", strategy: "sequence", status: "configuring", running: false } });
    expect(controller.trainingDrillPresets.get()).toBe(presets); expect(db.saveTrainingDrillPreset).not.toHaveBeenCalled(); expect(db.saveSettings).not.toHaveBeenCalled();
    expect(controller.training.drillCountdown.get()).toBeNull(); expect(controller.pattern).toBe(physical);
  });
  it.each(["oll", "pll"] as const)("same-set %s needs no Settings write", async family => {
    const controller = presetController(); vi.spyOn(db, "saveSettings").mockResolvedValue();
    expect(await controller.applyGuidedTrainingBlock(block({ context: { family, trainingSet: "full" }, caseIds: lastLayerCaseIds(family, "full").slice(0, 2) }))).toBe(true);
    expect(db.saveSettings).not.toHaveBeenCalled(); expect(controller.training.drillCountdown.get()).toBeNull();
  });
  it.each(["oll", "pll"] as const)("different-set %s is persist-first, busy and explicit Start", async family => {
    const controller = presetController(), settings = controller.settings.get(), runtime = controller.training.state.get();
    const presets = controller.trainingDrillPresets.get(), pending = deferred<void>(); vi.spyOn(db, "saveSettings").mockReturnValue(pending.promise);
    const caseIds = drillPolicy.drillCatalogue({ family, trainingSet: "2look" }).slice(0, 3).map(drillPolicy.drillCaseId);
    const loading = controller.applyGuidedTrainingBlock(block({ context: { family, trainingSet: "2look" }, caseIds, task: "execution", strategy: "weighted" }));
    expect(controller.trainingDrillConfigurationApplying.get()).toBe(true); controller.startTrainingDrill();
    expect(controller.settings.get()).toBe(settings); expect(controller.training.state.get()).toBe(runtime); expect(controller.training.drillCountdown.get()).toBeNull();
    pending.resolve(); expect(await loading).toBe(true); expect(controller.trainingDrillConfigurationApplying.get()).toBe(false);
    expect(controller.settings.get()[family === "oll" ? "ollTrainingSet" : "pllTrainingSet"]).toBe("2look");
    expect(controller.training.state.get()).toMatchObject({ family, activity: "drill", target: null,
      drill: { selectedCaseIds: caseIds, task: "execution", strategy: "weighted", running: false, status: "configuring" } });
    expect(controller.trainingDrillPresets.get()).toBe(presets); expect(controller.training.drillCountdown.get()).toBeNull();
    controller.startTrainingDrill(); expect(controller.training.drillCountdown.get()).toBe(2000);
  });
  it.each(["oll", "pll"] as const)("failed %s load preserves every live fact", async family => {
    const controller = presetController(), runtime = controller.training.state.get(), settings = controller.settings.get(), presets = controller.trainingDrillPresets.get();
    vi.spyOn(db, "saveSettings").mockRejectedValue(new Error("Guided settings failed"));
    expect(await controller.applyGuidedTrainingBlock(block({ context: { family, trainingSet: "2look" }, caseIds: lastLayerCaseIds(family, "2look").slice(0, 2) }))).toBe(false);
    expect(controller.training.state.get()).toBe(runtime); expect(controller.settings.get()).toBe(settings); expect(controller.trainingDrillPresets.get()).toBe(presets);
    expect(controller.training.drillCountdown.get()).toBeNull(); expect(controller.trainingDrillConfigurationApplying.get()).toBe(false); expect(controller.state.get().error).toContain("Guided settings failed");
  });
  it.each(["solving", "running", "summary"] as const)("refuses loading while %s", async phase => {
    const controller = presetController(); controller.training.state.update(s => phase === "solving" ? { ...s, phase } : { ...s, drill: { ...s.drill, status: phase, running: phase === "running" } });
    const before = controller.training.state.get(); expect(await controller.applyGuidedTrainingBlock(block())).toBe(false); expect(controller.training.state.get()).toBe(before);
  });
});


describe("Controller personal algorithm composition", () => {
  async function selectedPreferenceCase() {
    stubTimerLoop();
    const controller = readyController([session("1"), session("2")], "1");
    controller.setArea("training"); await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1"); return controller;
  }
  it("persists a canonical source before publishing and refreshes the same target", async () => {
    const controller = await selectedPreferenceCase();
    const before = controller.training.state.get(), alternative = before.target!.references[1];
    const pending = deferred<void>();
    vi.spyOn(db, "saveTrainingAlgorithmPreference").mockReturnValue(pending.promise);
    const saving = controller.useCanonicalTrainingAlgorithm(alternative.sourceAlg);
    await Promise.resolve();
    expect(controller.trainingAlgorithmPreferences.get()).toEqual([]);
    expect(controller.training.state.get()).toBe(before);
    pending.resolve(); expect(await saving).toEqual({ success: true });
    expect(db.saveTrainingAlgorithmPreference).toHaveBeenCalledWith(expect.objectContaining({ algorithm: alternative.sourceAlg, source: "catalog" }));
    expect(controller.training.state.get().target).toBe(before.target);
    expect(controller.training.state.get().preferredReference?.alg).toBe(alternative.alg);
    expect(controller.training.state.get()).not.toHaveProperty("trainingAlgorithmPreferences");
    expect(controller.sessions.get()).not.toHaveProperty("trainingAlgorithmPreferences");
  });
  it("rejects invalid syntax/semantics before persistence and reports a failed write without publication", async () => {
    const controller = await selectedPreferenceCase(), before = controller.training.state.get();
    const save = vi.spyOn(db, "saveTrainingAlgorithmPreference").mockRejectedValue(new Error("disk failed"));
    expect((await controller.setTrainingAlgorithmPreference("R ?")).success).toBe(false);
    expect((await controller.setTrainingAlgorithmPreference("R")).success).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect((await controller.setTrainingAlgorithmPreference(before.target!.references[0].sourceAlg)).success).toBe(false);
    expect(controller.trainingAlgorithmPreferences.get()).toEqual([]);
    expect(controller.training.state.get()).toBe(before); expect(controller.state.get().error).toContain("disk failed");
  });
  it("captures case A while a pending write permits navigation to B, without replacing B", async () => {
    const controller = await selectedPreferenceCase(); const a = controller.training.state.get().target!;
    const pending = deferred<void>(); vi.spyOn(db, "saveTrainingAlgorithmPreference").mockReturnValue(pending.promise);
    const saving = controller.setTrainingAlgorithmPreference(a.references[1].sourceAlg, "My grip");
    await Promise.resolve(); await controller.selectF2lCase("F2L 2");
    const b = controller.training.state.get();
    pending.resolve(); expect((await saving).success).toBe(true);
    expect(controller.trainingAlgorithmPreferences.get()[0].target).toMatchObject({ caseName: "F2L 1" });
    expect(controller.training.state.get()).toBe(b);
  });
  it("removes by deterministic key, restores canonical guide and refuses editing during solving", async () => {
    const controller = await selectedPreferenceCase();
    vi.spyOn(db, "saveTrainingAlgorithmPreference").mockResolvedValue();
    const target = controller.training.state.get().target!;
    await controller.useCanonicalTrainingAlgorithm(target.references[1].sourceAlg);
    const key = controller.trainingAlgorithmPreferences.get()[0].key;
    vi.spyOn(db, "deleteTrainingAlgorithmPreference").mockResolvedValue();
    expect((await controller.removeTrainingAlgorithmPreference()).success).toBe(true);
    expect(db.deleteTrainingAlgorithmPreference).toHaveBeenCalledWith(key);
    expect(controller.training.state.get().preferredReference).toBeNull();
    expect(controller.training.state.get().guide?.moves.join(" ")).toBe(target.references[0].alg);
    controller.training.state.update(state => ({ ...state, phase: "solving" }));
    expect((await controller.setTrainingAlgorithmPreference(target.references[0].sourceAlg)).success).toBe(false);
    expect((await controller.removeTrainingAlgorithmPreference()).success).toBe(false);
  });
  it("loads preferences independently during initialization", async () => {
    const controller = await selectedPreferenceCase();
    vi.spyOn(db, "saveTrainingAlgorithmPreference").mockResolvedValue();
    await controller.useCanonicalTrainingAlgorithm(controller.training.state.get().target!.references[0].sourceAlg);
    const preferences = controller.trainingAlgorithmPreferences.get();
    vi.mocked(db.loadTrainingAlgorithmPreferences).mockResolvedValue(preferences);
    vi.spyOn(db, "loadSettings").mockResolvedValue({ ...DEFAULT_SETTINGS });
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]); vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const fresh = new Controller(); vi.spyOn(fresh, "newScramble").mockResolvedValue(); await fresh.init();
    expect(fresh.trainingAlgorithmPreferences.get()).toEqual(preferences);
    expect(fresh.trainingDrillPresets.get()).toEqual([]); expect(fresh.trainingAttempts.get()).toEqual([]);
  });
});


it("canonical personal selection saves source notation rather than the randomized executable AUF", async () => {
  const controller = readyController([session("1")], "1"); controller.setArea("training");
  controller.setTrainingFamily("pll"); await controller.setTrainingMode("virtual");
  vi.spyOn(Math, "random").mockReturnValue(0.75);
  await controller.selectLastLayerCase("pll", "T");
  const reference = controller.training.state.get().target!.references[0];
  expect(reference.alg).not.toBe(reference.sourceAlg);
  vi.spyOn(db, "saveTrainingAlgorithmPreference").mockResolvedValue();
  expect((await controller.useCanonicalTrainingAlgorithm(reference.sourceAlg)).success).toBe(true);
  expect(controller.trainingAlgorithmPreferences.get()[0].algorithm).toBe(reference.sourceAlg);
  expect(db.saveTrainingAlgorithmPreference).toHaveBeenCalledWith(expect.objectContaining({ algorithm: reference.sourceAlg }));
});
it("an immediate backup waits for pending personal configuration writes", async () => {
  const controller = readyController([session("1")], "1"); controller.setArea("training");
  await controller.setTrainingMode("virtual"); await controller.selectF2lCase("F2L 1");
  const pending = deferred<void>();
  vi.spyOn(db, "saveTrainingAlgorithmPreference").mockImplementation(async preference => {
    await pending.promise; vi.mocked(db.loadTrainingAlgorithmPreferences).mockResolvedValue([preference]);
  });
  vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]); vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
  const saving = controller.useCanonicalTrainingAlgorithm(controller.training.state.get().target!.references[0].sourceAlg);
  const exporting = controller.exportData();
  await Promise.resolve(); expect(db.loadTrainingAlgorithmPreferences).not.toHaveBeenCalled();
  pending.resolve(); await saving;
  expect(JSON.parse(await exporting).trainingAlgorithmPreferences).toEqual(controller.trainingAlgorithmPreferences.get());
});

describe("Controller Recognition history composition", () => {
  function runningRecognition() {
    stubTimerLoop(); const controller = readyController([session("1")], "1");
    controller.setArea("training"); controller.setTrainingActivity("drill"); controller.setDrillTask("recognition");
    controller.setDrillCases(["F2L 4", "F2L 5"]); controller.startTrainingDrill();
    controller.training.tick(performance.now() + 2001); return controller;
  }
  it("publishes one answer immediately, keeps Execution/Session stores separate and waits for history before backup", async () => {
    const pending = deferred<void>(); vi.mocked(db.saveTrainingRecognitionAttempt).mockReturnValue(pending.promise);
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]); vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    const controller = runningRecognition(); controller.submitTrainingRecognition("F2L 5"); controller.submitTrainingRecognition("F2L 4");
    expect(controller.trainingRecognitionAttempts.get()).toHaveLength(1); expect(db.saveTrainingRecognitionAttempt).toHaveBeenCalledOnce();
    const attempt = controller.trainingRecognitionAttempts.get()[0]; expect(attempt).toMatchObject({ answerCaseId: "F2L 5", drillRound: 1 });
    expect(attempt.drillRunId).toBe(controller.training.state.get().drill.runId);
    expect(controller.trainingAttempts.get()).toEqual([]); expect(controller.sessions.get().solves).toEqual([]);
    expect(controller.training.state.get()).not.toHaveProperty("trainingRecognitionAttempts");
    let exported = false; const backup = controller.exportData().then(json => { exported = true; return json; });
    await Promise.resolve(); expect(exported).toBe(false); pending.resolve();
    vi.mocked(db.loadTrainingRecognitionAttempts).mockResolvedValue([attempt]);
    expect(JSON.parse(await backup)).toMatchObject({ version: 7, trainingRecognitionAttempts: [attempt] });
  });
  it("retains visible answer/result after failed persistence and reports the error", async () => {
    vi.mocked(db.saveTrainingRecognitionAttempt).mockRejectedValue(new Error("recognition disk full"));
    const controller = runningRecognition(); controller.submitTrainingRecognition("F2L 4");
    await Promise.resolve(); await Promise.resolve();
    expect(controller.trainingRecognitionAttempts.get()).toHaveLength(1);
    expect(controller.training.state.get().recognition?.result?.correct).toBe(true);
    expect(controller.state.get().error).toContain("recognition disk full");
  });
  it("loads Recognition independently and refreshes it after JSON import", async () => {
    const attempt = { id: "answer", createdAt: 100, drillRunId: "run", drillRound: 1,
      target: { family: "oll" as const, trainingSet: "full" as const, caseId: "27" }, answerCaseId: "26", responseMs: 600 };
    vi.mocked(db.loadTrainingRecognitionAttempts).mockResolvedValue([attempt]);
    vi.spyOn(db, "loadSettings").mockResolvedValue(DEFAULT_SETTINGS); vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]); vi.spyOn(db, "loadAllSolves").mockResolvedValue([]);
    const controller = new Controller(); vi.spyOn(controller, "newScramble").mockResolvedValue(); await controller.init();
    expect(controller.trainingRecognitionAttempts.get()).toEqual([attempt]); expect(controller.trainingAttempts.get()).toEqual([]);
    const result = await controller.importData(JSON.stringify({ version: 7, sessions: [], solves: [], trainingRecognitionAttempts: [attempt] }));
    expect(result.trainingRecognitionAttempts).toBe(1); expect(controller.trainingRecognitionAttempts.get()).toEqual([attempt]);
  });
});


it("rejects untrusted solve-specific Training before changing area or delegating", async () => {
  const controller = new Controller();
  const alg = new Alg("R U R' U R U2 R'");
  const moves = Array.from(alg.childAlgNodes()).map((node, i) => ({ move: node.toString(), t: (i + 1) * 200 }));
  const analysis = analyseSolve(kpuzzle.defaultPattern().applyAlg(alg.invert()), moves)!;
  analysis.quality = { status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["D", "L"] }] };
  const practice = vi.spyOn(controller.training, "practiceSolveStep").mockResolvedValue();
  await controller.practiceSolveStep({ ...solveFor("A"), analysis }, analysis.steps[5]);
  expect(practice).not.toHaveBeenCalled(); expect(controller.snapshot().area).toBe("timer");
  const trusted = { ...analysis, quality: { status: "trusted" as const, issues: [] } };
  await controller.practiceSolveStep({ ...solveFor("A"), analysis: trusted, cfopAnalysisExcluded: true }, trusted.steps[5]);
  expect(practice).not.toHaveBeenCalled();
  await controller.practiceSolveStep({ ...solveFor("A"), analysis: trusted }, trusted.steps[5]);
  expect(practice).toHaveBeenCalledOnce(); expect(controller.snapshot().area).toBe("training");
});


it("updates durable CFOP veto and undo in active History and last Result without changing timing", async () => {
  const recorded = solveFor("1");
  const controller = readyController([session("1")], "1", [recorded]);
  const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
  await controller.updateSolve(recorded.id, { cfopAnalysisExcluded: true });
  expect(save).toHaveBeenLastCalledWith({ ...recorded, cfopAnalysisExcluded: true });
  expect(controller.sessions.get().solves[0].cfopAnalysisExcluded).toBe(true);
  expect(controller.sessions.get().lastSolve?.cfopAnalysisExcluded).toBe(true);
  expect(controller.sessions.get().lastSolve?.rawMs).toBe(recorded.rawMs);
  await controller.updateSolve(recorded.id, { cfopAnalysisExcluded: undefined });
  expect(controller.sessions.get().solves[0].cfopAnalysisExcluded).toBeUndefined();
  expect(controller.sessions.get().lastSolve?.cfopAnalysisExcluded).toBeUndefined();
});
