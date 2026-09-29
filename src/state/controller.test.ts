import { afterEach, describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { invert, reorientMove, rotationForCrossFace } from "../cube/orientation";
import { F2L_CASES } from "../cube/f2lCases";
import { buildStandardF2lTarget } from "../cube/f2lTraining";
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

    const rotation = rotationForCrossFace(target.info.crossFace);
    const cubeMoves = Array.from(new Alg(F2L_CASES[0].alg).expand().childAlgNodes()).map(
      (node) => reorientMove(node.toString(), invert(rotation.orientation)),
    );
    const physicalAfter = physicalStart.applyAlg(new Alg(cubeMoves.join(" ")));
    for (const move of cubeMoves) controller.injectMove(move);

    expect(controller.state.get().f2lTraining.phase).toBe("result");
    expect(controller.state.get().solves).toEqual([]);
    expect(patternToFacelets(controller.pattern!)).toBe(patternToFacelets(physicalAfter));
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(target.pattern.applyAlg(new Alg(cubeMoves.join(" ")))),
    );

    const physicalResult = patternToFacelets(controller.pattern!);
    controller.againF2lTraining();
    expect(controller.state.get().f2lTraining.phase).toBe("ready");
    expect(patternToFacelets(controller.pattern!)).toBe(physicalResult);
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(
      patternToFacelets(target.pattern),
    );

    await controller.setF2lMode("setup");
    expect(controller.state.get().f2lTraining.mode).toBe("setup");
    expect(controller.state.get().f2lTraining.setup.length).toBeGreaterThan(0);
    expect(controller.state.get().f2lTraining.displayFacelets).toBe(physicalResult);
  });
});
