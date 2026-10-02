import { afterEach, describe, expect, it, vi } from "vitest";
import { Alg } from "cubing/alg";
import { invert, reorientMove } from "../cube/orientation";
import { F2L_TRAINING_CATALOGUES, findF2lTrainingCase } from "../cube/f2lTrainingCases";
import { F2L_POSITIONS } from "../cube/f2lCases";
import {
  buildF2lCatalogueTarget,
  f2lCubeAlgorithm,
  f2lTrainingGrip,
  isStandardF2lBase,
  referenceExecutionSignature,
} from "../cube/f2lTraining";
import { CubeModel, patternToFacelets } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import { Controller } from "./controller";
import * as db from "./db";
import { DEFAULT_EVENT_ID } from "../cube/scramble";
import { formatSolveCsv } from "./solveCsv";
import { DEFAULT_SETTINGS, type Session, type Solve } from "./types";

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
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
}

function readyController(
  sessions: Session[],
  sessionId: string,
  solves: Solve[] = [],
  phase: "finished" | "ready" | "inspection" | "solving" = "finished",
): Controller {
  const controller = new Controller(new CubeModel(kpuzzle));
  controller.state.update((state) => ({
    ...state,
    ready: true,
    sessions,
    sessionId,
    solves,
    lastSolve: solves.at(-1) ?? null,
    phase,
  }));
  return controller;
}

function stubPersistence() {
  vi.spyOn(db, "saveSession").mockResolvedValue();
  vi.spyOn(db, "loadSolves").mockResolvedValue([]);
  vi.spyOn(db, "deleteSession").mockResolvedValue();
}

describe("Controller application-area ownership", () => {
  it("cancels timer work without creating or changing a normal solve", () => {
    const controller = new Controller();
    const solve = { id: "existing" } as Solve;
    controller.state.update((state) => ({
      ...state,
      phase: "solving",
      solveSource: "smartcube",
      liveMoves: ["R"],
      solves: [solve],
      lastSolve: solve,
    }));

    controller.setArea("f2l");
    controller.injectMove("U");

    expect(controller.state.get().area).toBe("f2l");
    expect(controller.state.get().phase).toBe("scrambling");
    expect(controller.state.get().f2lTraining.phase).toBe("selecting");
    expect(controller.state.get().solves).toEqual([solve]);
    expect(controller.state.get().lastSolve).toBe(solve);
  });

  it("parks Timer for a historical review without adopting the training position", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    const controller = new Controller(
      new CubeModel(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg("R U"))),
    );
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    await controller.setF2lMode("virtual");
    await controller.selectF2lCase("F2L 1");
    controller.injectMove("L");
    const trainingPosition = patternToFacelets(controller.pattern!);

    controller.returnToTimerReview();

    expect(controller.state.get().area).toBe("timer");
    expect(controller.state.get().phase).toBe("finished");
    expect(controller.state.get().phase).not.toBe("ready");
    expect(controller.state.get().phase).not.toBe("inspection");
    expect(controller.state.get().phase).not.toBe("solving");
    expect(controller.state.get().f2lTraining.phase).toBe("selecting");
    expect(controller.state.get().f2lTraining.target).toBeNull();
    expect(controller.state.get().solves).toEqual([]);
    expect(patternToFacelets(controller.pattern!)).toBe(trainingPosition);
    expect(controller.state.get().scramble).toBe("");
  });

  it("keeps virtual practice separate from the physical cube", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

    const physicalStart = kpuzzle.defaultPattern().applyAlg(new Alg("R U F"));
    const controller = new Controller(new CubeModel(kpuzzle, physicalStart));
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    await controller.setF2lMode("virtual");
    await controller.selectF2lCase("F2L 1");

    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(controller.state.get().f2lTraining.setup).toBe("");
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );

    const grip = f2lTrainingGrip(target.info);
    const cubeMoves = Array.from(new Alg(BASIC_CASES[0].algorithms.FR[0]).expand().childAlgNodes()).map(
      (node) => reorientMove(node.toString(), invert(grip)),
    );
    const physicalAfter = physicalStart.applyAlg(new Alg(cubeMoves.join(" ")));
    for (const move of cubeMoves) controller.injectMove(move);

    const completedResult = controller.state.get().f2lTraining.result;
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(controller.state.get().solves).toEqual([]);
    expect(patternToFacelets(controller.pattern!)).toBe(patternToFacelets(physicalAfter));
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );
    expect(completedResult?.moves).toEqual(
      Array.from(new Alg(BASIC_CASES[0].algorithms.FR[0]).expand().childAlgNodes()).map((node) => node.toString()),
    );
    expect(controller.state.get().f2lTraining.result).toEqual(completedResult);
    expect(controller.state.get().f2lTraining.liveMoves).toEqual([]);

    controller.injectMove(cubeMoves[0]);
    expect(controller.state.get().f2lTraining.phase).toBe("solving");
    expect(controller.state.get().f2lTraining.result).toBeNull();
    expect(controller.state.get().f2lTraining.liveMoves).toEqual(["U"]);

    const physicalResult = patternToFacelets(controller.pattern!);
    controller.againF2lTraining();
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(patternToFacelets(controller.pattern!)).toBe(physicalResult);
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );
    expect(controller.state.get().f2lTraining.result).toBeNull();

    await controller.setF2lMode("setup");
    expect(controller.state.get().f2lTraining.mode).toBe("setup");
    expect(controller.state.get().f2lTraining.setup.length).toBeGreaterThan(0);
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(physicalResult);
  });

  it("keeps solve-step practice exact across mode changes and retries", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

    const exact = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    const solve = {
      id: "solve-step-controller",
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
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, virtualCube: true }));

    controller.setArea("f2l");
    controller.setF2lLibrary("advanced");
    await controller.practiceF2lStep(solve, step);
    const setupTarget = controller.state.get().f2lTraining.target;
    expect(controller.state.get().area).toBe("f2l");
    expect(setupTarget?.origin).toMatchObject({
      kind: "solve-step",
      solveId: solve.id,
      slot: exact.info.slot,
    });
    await controller.setF2lMode("virtual");
    expect(controller.state.get().f2lTraining.target?.origin.kind).toBe("solve-step");
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(exact.pattern),
    );
    expect(controller.state.get().f2lTraining.selectedLibrary).toBe("advanced");
    controller.againF2lTraining();
    await Promise.resolve();
    expect(controller.state.get().f2lTraining.target?.origin.kind).toBe("solve-step");
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(exact.pattern),
    );
  });

  it("rebuilds standard setup from the current F2L-complete base", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    await controller.selectF2lCase("F2L 4");

    expect(controller.state.get().f2lTraining.setup).toBe("R U' R'");
    const firstTarget = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[3]);
    const firstGrip = f2lTrainingGrip(firstTarget.info);
    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].setup, firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    expect(controller.state.get().f2lTraining.phase).toBe("ready");

    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].algorithms.FR[0], firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    expect(controller.state.get().f2lTraining.phase).toBe("result");
    expect(isStandardF2lBase(controller.pattern!)).toBe(true);

    const completedResult = controller.state.get().f2lTraining.result;
    controller.injectMove("D");
    controller.injectMove("D");
    controller.injectMove("D");
    expect(controller.state.get().f2lTraining.phase).toBe("result");
    expect(controller.state.get().f2lTraining.result).toEqual(completedResult);
    controller.injectMove("D");
    expect(controller.state.get().f2lTraining.phase).toBe("preparing");
    expect(controller.state.get().f2lTraining.result).toBeNull();
    expect(controller.state.get().f2lTraining.liveMoves).toEqual([]);

    const baseAfterAttempt = controller.pattern!;
    const expectedNextTarget = buildF2lCatalogueTarget(
      kpuzzle,
      BASIC_CASES[3],
      baseAfterAttempt,
    );
    controller.againF2lTraining();
    expect(controller.state.get().f2lTraining.setup).toBe("R U' R'");
    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].setup, firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    expect(patternToFacelets(controller.pattern!)).toBe(
      patternToFacelets(expectedNextTarget.pattern),
    );

    for (const move of f2lCubeAlgorithm(BASIC_CASES[3].algorithms.FR[0], firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    await controller.selectF2lCase("F2L 3");
    expect(controller.state.get().f2lTraining.setup).toBe("F' U F");
  });

  it("keeps the selected standard position through mode changes and retry", async () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    await controller.selectF2lCase("F2L 10");
    await controller.selectF2lPosition("BL");

    expect(controller.state.get().f2lTraining.selectedPosition).toBe("BL");
    expect(controller.state.get().f2lTraining.target?.position).toBe("BL");
    expect(controller.state.get().f2lTraining.target?.origin.kind).toBe("catalog");
    const firstSetup = controller.state.get().f2lTraining.setup;
    expect(firstSetup).toBeTruthy();

    await controller.setF2lMode("virtual");
    expect(controller.state.get().f2lTraining.target?.position).toBe("BL");
    controller.againF2lTraining();
    await Promise.resolve();
    expect(controller.state.get().f2lTraining.target?.position).toBe("BL");
    await controller.setF2lMode("setup");
    expect(controller.state.get().f2lTraining.target?.position).toBe("BL");
    expect(controller.state.get().f2lTraining.setup).toBe(firstSetup);
  });

  it("keeps the generic setup fallback for a non-F2L-complete start", async () => {
    const physicalStart = kpuzzle.defaultPattern().applyAlg(new Alg("R U F"));
    const controller = new Controller(new CubeModel(kpuzzle, physicalStart));
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    await controller.selectF2lCase("F2L 4");

    const setup = controller.state.get().f2lTraining.setup;
    expect(setup.length).toBeGreaterThan(0);
    expect(controller.state.get().f2lTraining.phase).toBe("preparing");
  });
});

describe("Controller Advanced F2L catalogue", () => {
  function controllerAtBase(base = kpuzzle.defaultPattern()) {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    const controller = new Controller(new CubeModel(kpuzzle, base));
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    return controller;
  }

  it("defaults to Basic and clears catalogue selection without changing mode, slot or physical state", async () => {
    const controller = controllerAtBase();
    expect(controller.state.get().f2lTraining.selectedLibrary).toBe("basic");
    await controller.setF2lMode("virtual");
    await controller.selectF2lPosition("BL");
    await controller.selectF2lCase("F2L 3");
    controller.injectMove("L");
    expect(controller.state.get().f2lTraining.liveMoves.length).toBeGreaterThan(0);
    const physical = patternToFacelets(controller.pattern!);
    controller.setF2lLibrary("advanced");
    expect(controller.state.get().f2lTraining).toMatchObject({ selectedLibrary: "advanced",
      selectedPosition: "BL", mode: "virtual", phase: "selecting", target: null,
      result: null, setup: "", setupProgress: null, recovery: null, recoveryPending: false, liveMoves: [] });
    expect(controller.state.get().area).toBe("f2l");
    expect(patternToFacelets(controller.pattern!)).toBe(physical);
    await controller.selectF2lCase("F2L 3");
    expect(controller.state.get().f2lTraining.target).toBeNull();
    await controller.selectF2lCase("AF2L 3");
    expect(controller.state.get().f2lTraining.target?.origin).toMatchObject({ kind: "catalog", library: "advanced", caseName: "AF2L 3" });
    controller.setF2lLibrary("basic");
    expect(controller.state.get().f2lTraining).toMatchObject({ selectedLibrary: "basic", selectedPosition: "BL", mode: "virtual", target: null, phase: "selecting" });
    await controller.selectF2lCase("AF2L 3");
    expect(controller.state.get().f2lTraining.target).toBeNull();
    expect(patternToFacelets(controller.pattern!)).toBe(physical);
  });

  it("repositions the authoritative Advanced case and keeps it through retry/mode changes", async () => {
    const controller = controllerAtBase();
    controller.setF2lLibrary("advanced");
    await controller.setF2lMode("virtual");
    await controller.selectF2lCase("AF2L 3");
    for (const position of F2L_POSITIONS) {
      await controller.selectF2lPosition(position);
      const expected = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase("advanced", "AF2L 3")!, position);
      expect(controller.state.get().f2lTraining.target?.position).toBe(position);
      expect(controller.state.get().f2lTraining.displayFacelets).toBe(patternToFacelets(expected.pattern));
    }
    controller.againF2lTraining();
    await Promise.resolve();
    expect(controller.state.get().f2lTraining.target?.origin).toMatchObject({ library: "advanced", caseName: "AF2L 3" });
    await controller.setF2lMode("setup");
    expect(controller.state.get().f2lTraining).toMatchObject({ selectedLibrary: "advanced", selectedPosition: "BR", mode: "setup", phase: "preparing" });
    await controller.setF2lMode("virtual");
    expect(controller.state.get().f2lTraining).toMatchObject({ selectedLibrary: "advanced", selectedPosition: "BR", phase: "ready" });
  });

  it("runs Advanced direct Setup, completion and Again on the ordinary path with a physical LL base", async () => {
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    const controller = controllerAtBase(base);
    controller.setF2lLibrary("advanced");
    await controller.selectF2lPosition("FL");
    await controller.selectF2lCase("AF2L 3");
    const entry = findF2lTrainingCase("advanced", "AF2L 3")!;
    const expected = buildF2lCatalogueTarget(kpuzzle, entry, "FL", base);
    const training = controller.state.get().f2lTraining;
    expect(training.setup).toBe(referenceExecutionSignature(entry.setup)!.join(" "));
    for (const move of f2lCubeAlgorithm(training.setup, f2lTrainingGrip(expected.info)).split(" ")) controller.injectMove(move);
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(patternToFacelets(controller.pattern!)).toBe(patternToFacelets(expected.pattern));
    const reference = expected.info.references.find((candidate) => referenceExecutionSignature(candidate.alg) !== null)!;
    const execution = referenceExecutionSignature(reference.alg)!;
    for (const move of f2lCubeAlgorithm(execution.join(" "), f2lTrainingGrip(expected.info)).split(" ")) controller.injectMove(move);
    expect(controller.state.get().f2lTraining.phase).toBe("result");
    expect(controller.state.get().f2lTraining.result?.matchedReferenceRank).toBe(reference.rank);
    controller.againF2lTraining();
    await Promise.resolve();
    expect(controller.state.get().f2lTraining.target?.origin).toMatchObject({ library: "advanced", caseName: "AF2L 3" });
    expect(controller.state.get().f2lTraining.selectedPosition).toBe("FL");
    expect(controller.state.get().f2lTraining.result).toBeNull();
    controller.setF2lLibrary("basic");
    expect(controller.state.get().f2lTraining).toMatchObject({ mode: "setup", selectedPosition: "FL", setup: "", target: null, setupProgress: null });
  });

  it("uses the existing generic Setup fallback for the exact authoritative slice case", async () => {
    const controller = controllerAtBase(kpuzzle.defaultPattern().applyAlg(new Alg("R U F")));
    controller.setF2lLibrary("advanced");
    await controller.selectF2lPosition("BR");
    await controller.selectF2lCase("AF2L 1");
    const expected = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase("advanced", "AF2L 1")!, "BR");
    const training = controller.state.get().f2lTraining;
    expect(training.phase).toBe("preparing");
    expect(training.setup).toMatch(/^[URFDLB2' ]+$/);
    for (const move of f2lCubeAlgorithm(training.setup, f2lTrainingGrip(expected.info)).split(" ")) controller.injectMove(move);
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(patternToFacelets(controller.pattern!)).toBe(patternToFacelets(expected.pattern));
  });

  it("automatically repeats Advanced virtual attempts and clears results on library changes", async () => {
    const controller = controllerAtBase();
    controller.setF2lLibrary("advanced");
    await controller.setF2lMode("virtual");
    await controller.selectF2lPosition("FL");
    await controller.selectF2lCase("AF2L 3");
    const target = controller.state.get().f2lTraining.target!;
    const reference = target.references.find((candidate) => referenceExecutionSignature(candidate.alg) !== null)!;
    const execution = referenceExecutionSignature(reference.alg)!;
    for (const move of f2lCubeAlgorithm(execution.join(" "), f2lTrainingGrip(target)).split(" ")) controller.injectMove(move);
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(controller.state.get().f2lTraining.result?.matchedReferenceRank).toBe(reference.rank);
    controller.setF2lLibrary("basic");
    expect(controller.state.get().f2lTraining).toMatchObject({ phase: "selecting", mode: "virtual", selectedPosition: "FL", result: null, target: null, liveMoves: [] });
  });

  it("cancels an in-flight Advanced setup when the library changes", async () => {
    const controller = controllerAtBase(kpuzzle.defaultPattern().applyAlg(new Alg("R U F")));
    controller.setF2lLibrary("advanced");
    await controller.selectF2lPosition("BR");
    const selecting = controller.selectF2lCase("AF2L 25");
    expect(controller.state.get().f2lTraining.phase).toBe("preparing");
    const physical = patternToFacelets(controller.pattern!);
    controller.setF2lLibrary("basic");
    await selecting;
    expect(controller.state.get().f2lTraining).toMatchObject({ selectedLibrary: "basic", selectedPosition: "BR", mode: "setup", target: null, phase: "selecting", setup: "", setupProgress: null, recovery: null, recoveryPending: false });
    expect(patternToFacelets(controller.pattern!)).toBe(physical);
  });
});

describe("Controller Session event ownership", () => {
  it("creates the first Session with the canonical default event", async () => {
    vi.spyOn(db, "loadSettings").mockResolvedValue({ ...DEFAULT_SETTINGS });
    vi.spyOn(db, "loadSessions").mockResolvedValue([]);
    vi.spyOn(db, "saveSession").mockResolvedValue();
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);

    const controller = new Controller();
    vi.spyOn(controller, "newScramble").mockResolvedValue();

    await controller.init();

    expect(controller.state.get().sessions[0].event).toBe(DEFAULT_EVENT_ID);
  });

  it("changes an empty Session in place and regenerates its scramble", async () => {
    stubPersistence();
    const controller = readyController([session("1")], "1");
    const newScramble = vi.spyOn(controller, "newScramble").mockResolvedValue();

    await controller.changeEvent("222");

    expect(controller.state.get().sessions).toEqual([
      expect.objectContaining({ id: "1", name: "Session 1", event: "222" }),
    ]);
    expect(db.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", event: "222" }),
    );
    expect(newScramble).toHaveBeenCalledOnce();
  });

  it("creates a new Session for an event change once history exists", async () => {
    stubPersistence();
    const original = session("1");
    const solve = solveFor(original.id);
    const controller = readyController([original], original.id, [solve]);
    vi.spyOn(controller, "newScramble").mockResolvedValue();

    await controller.changeEvent("222");

    const state = controller.state.get();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0]).toMatchObject({ id: original.id, event: DEFAULT_EVENT_ID });
    expect(state.sessions[1]).toMatchObject({ event: "222", name: "Session 2" });
    expect(state.sessionId).toBe(state.sessions[1].id);
    expect(state.solves).toEqual([]);
    expect(solve.sessionId).toBe(original.id);
  });

  it("makes normal new Sessions inherit the selected Session event", async () => {
    stubPersistence();
    const controller = readyController([session("1", "222")], "1");

    await controller.createSession("Session 2");

    expect(controller.state.get().sessions.at(-1)?.event).toBe("222");
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
    expect(different.state.get().sessionId).toBe("2");

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
    smart.state.update((state) => ({ ...state, virtualCube: true }));
    smart.setScramble("R U");
    expect(smart.state.get().scrambleProgress).not.toBeNull();

    const nonSmart = readyController([session("1", "222")], "1");
    nonSmart.state.update((state) => ({ ...state, virtualCube: true }));
    nonSmart.setScramble("R U");
    expect(nonSmart.state.get().scrambleProgress).toBeNull();
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

      expect(controller.state.get().sessions).toEqual(sessions);
      expect(controller.state.get().sessionId).toBe("1");
    },
  );
});

describe("Controller Session-context synchronization", () => {
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

    expect(controller.state.get().phase).toBe("ready");
    loading.resolve([]);
    await selecting;
    expect(controller.state.get().sessionId).toBe("2");

    controller.startFromKeyboard();
    expect(controller.state.get().phase).toBe("solving");
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
    expect(controller.state.get().phase).toBe("ready");

    saving.resolve();
    await changing;
    expect(controller.state.get().sessions[0].event).toBe("222");
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
    expect(controller.state.get().phase).toBe("ready");

    deleting.resolve();
    await deletingSession;
    expect(controller.state.get().sessionId).toBe("2");
    expect(controller.state.get().solves).toEqual([]);
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
    expect(controller.state.get().sessionId).toBe("1");
    expect(db.loadSolves).toHaveBeenCalledTimes(1);

    loading.resolve([]);
    await first;
    expect(controller.state.get().sessionId).toBe("2");
  });
});

describe("Controller import Session invariants", () => {
  function jsonExport(sessions: Session[], solves: Solve[] = []): string {
    return JSON.stringify({ format: "cubetimer", version: 2, sessions, solves });
  }

  it("rejects a JSON event conflict before overwriting a Session with history", async () => {
    const local = session("A", "333");
    const localSolve = solveFor(local.id);
    vi.spyOn(db, "loadSessions").mockResolvedValue([local]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([localSolve]);
    const saveSession = vi.spyOn(db, "saveSession").mockResolvedValue();
    const controller = readyController([local], local.id, [localSolve]);

    await expect(
      controller.importData(jsonExport([{ ...local, event: "222" }])),
    ).rejects.toThrow(/Cannot merge session/);

    expect(saveSession).not.toHaveBeenCalled();
    expect(controller.state.get().sessions[0].event).toBe("333");
    expect(controller.state.get().solves[0].sessionId).toBe(local.id);
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
    const newScramble = vi.spyOn(controller, "newScramble").mockResolvedValue();

    await controller.importData(jsonExport([after]));

    expect(controller.state.get().sessions).toEqual([after]);
    expect(newScramble).toHaveBeenCalledOnce();
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
    expect(controller.state.get().phase).toBe("ready");

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
    expect(controller.state.get().phase).toBe("ready");

    saving.resolve();
    await importing;
  });

  it("keeps repeated compatible CSV imports idempotent", async () => {
    const local = session("A");
    const imported: Session = {
      id: "import:Imported",
      name: "Imported",
      event: DEFAULT_EVENT_ID,
      createdAt: 0,
    };
    const importedSolve = solveFor(imported.id);
    const csv = formatSolveCsv(
      [importedSolve],
      new Map([[imported.id, imported.name]]),
    );
    const sessionStore = new Map([[local.id, local]]);
    const solveStore = new Map<string, Solve>();
    vi.spyOn(db, "loadSessions").mockImplementation(async () => [
      ...sessionStore.values(),
    ]);
    vi.spyOn(db, "loadAllSolves").mockImplementation(async () => [
      ...solveStore.values(),
    ]);
    vi.spyOn(db, "loadSolves").mockImplementation(async (sessionId) =>
      [...solveStore.values()].filter((solve) => solve.sessionId === sessionId),
    );
    vi.spyOn(db, "saveSession").mockImplementation(async (value) => {
      sessionStore.set(value.id, value);
    });
    vi.spyOn(db, "saveSolve").mockImplementation(async (value) => {
      solveStore.set(value.id, value);
    });
    const controller = readyController([local], local.id);

    await controller.importSolveCsv(csv);
    await controller.importSolveCsv(csv);

    expect(sessionStore.size).toBe(2);
    expect(solveStore.size).toBe(1);
    expect([...solveStore.values()][0].sessionId).toBe(imported.id);
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

  it("rejects a conflicting CSV Session before overwriting history", async () => {
    const local: Session = {
      id: "import:Imported",
      name: "Imported",
      event: "222",
      createdAt: 0,
    };
    const localSolve = solveFor(local.id);
    const csv = formatSolveCsv(
      [solveFor(local.id)],
      new Map([[local.id, local.name]]),
    );
    vi.spyOn(db, "loadSessions").mockResolvedValue([local]);
    vi.spyOn(db, "loadAllSolves").mockResolvedValue([localSolve]);
    const saveSession = vi.spyOn(db, "saveSession").mockResolvedValue();
    const controller = readyController([local], local.id, [localSolve]);

    await expect(controller.importSolveCsv(csv)).rejects.toThrow(/Cannot merge session/);
    expect(saveSession).not.toHaveBeenCalled();
    expect(controller.state.get().sessions[0].event).toBe("222");
  });
});
