import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildF2lCatalogueTarget,
  f2lTrainingGrip
} from "../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../cube/f2lTrainingCases";
import { buildLastLayerCatalogueTarget, isLastLayerTrainingComplete } from "../cube/lastLayerTraining";
import { CubeModel, patternToFacelets } from "../cube/model";
import { invert, reorientMove } from "../cube/orientation";
import { get3x3x3 } from "../cube/puzzle";
import { DEFAULT_EVENT_ID } from "../cube/scramble";
import * as solver from "../cube/solver";
import { cubeMove } from "../cube/frames";
import { trainingGrip } from "../cube/training";
import { Controller } from "./Controller";
import * as db from "../infrastructure/persistence/db";
import { formatSolveCsv } from "../features/data-transfer/solveCsv";
import type { Session, Solve } from "./types";

const kpuzzle = await get3x3x3();
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

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
    await controller.setF2lMode("virtual");
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
    await controller.setF2lMode("virtual");
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
    const adopt = vi.spyOn(controller, "useCubeStateAsScramble").mockResolvedValue();
    const generate = vi.spyOn(controller, "newScramble").mockResolvedValue();

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
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => { }) as typeof cancelAnimationFrame;

    const physicalStart = kpuzzle.defaultPattern().applyAlg(new Alg("R U F"));
    const controller = new Controller(new CubeModel(kpuzzle, physicalStart));
    controller.physical.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("training");
    await controller.setF2lMode("virtual");
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
      patternToFacelets(target.pattern),
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
    controller.againF2lTraining();
    expect(controller.training.state.get().phase).toBe("ready");
    expect(patternToFacelets(controller.pattern!)).toBe(physicalResult);
    expect(controller.training.state.get().displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );
    expect(controller.training.state.get().result).toBeNull();

    await controller.setF2lMode("setup");
    expect(controller.training.state.get().mode).toBe("setup");
    expect(controller.training.state.get().setup.length).toBeGreaterThan(0);
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
