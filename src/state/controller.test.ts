import { afterEach, describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { invert, reorientMove } from "../cube/orientation";
import { F2L_CASES } from "../cube/f2lCases";
import {
  buildStandardF2lTarget,
  f2lCubeAlgorithm,
  f2lTrainingGrip,
  isStandardF2lBase,
} from "../cube/f2lTraining";
import { CubeModel, patternToFacelets } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import { Controller } from "./controller";
import type { Solve } from "./types";

const kpuzzle = await get3x3x3();
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

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

  it("keeps virtual practice separate from the physical cube", async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

    const physicalStart = kpuzzle.defaultPattern().applyAlg(new Alg("R U F"));
    const controller = new Controller(new CubeModel(kpuzzle, physicalStart));
    controller.state.update((state) => ({ ...state, virtualCube: true }));
    controller.setArea("f2l");
    await controller.setF2lMode("virtual");
    await controller.selectF2lCase("F2L 1");

    const target = buildStandardF2lTarget(kpuzzle, F2L_CASES[0]);
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(controller.state.get().f2lTraining.setup).toBe("");
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );

    const grip = f2lTrainingGrip(target.info);
    const cubeMoves = Array.from(new Alg(F2L_CASES[0].alg).expand().childAlgNodes()).map(
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
      Array.from(new Alg(F2L_CASES[0].alg).expand().childAlgNodes()).map((node) => node.toString()),
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

    const exact = buildStandardF2lTarget(kpuzzle, F2L_CASES[0]);
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
    const firstTarget = buildStandardF2lTarget(kpuzzle, F2L_CASES[3]);
    const firstGrip = f2lTrainingGrip(firstTarget.info);
    for (const move of f2lCubeAlgorithm(F2L_CASES[3].setup, firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    expect(controller.state.get().f2lTraining.phase).toBe("ready");

    for (const move of f2lCubeAlgorithm(F2L_CASES[3].alg, firstGrip).split(" ")) {
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
    const expectedNextTarget = buildStandardF2lTarget(
      kpuzzle,
      F2L_CASES[3],
      baseAfterAttempt,
    );
    controller.againF2lTraining();
    expect(controller.state.get().f2lTraining.setup).toBe("R U' R'");
    for (const move of f2lCubeAlgorithm(F2L_CASES[3].setup, firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    expect(patternToFacelets(controller.pattern!)).toBe(
      patternToFacelets(expectedNextTarget.pattern),
    );

    for (const move of f2lCubeAlgorithm(F2L_CASES[3].alg, firstGrip).split(" ")) {
      controller.injectMove(move);
    }
    await controller.selectF2lCase("F2L 3");
    expect(controller.state.get().f2lTraining.setup).toBe("F' U F");
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
