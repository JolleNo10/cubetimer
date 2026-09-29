import { describe, expect, it } from "vitest";
import { Controller } from "./controller";
import type { Solve } from "./types";

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
});
