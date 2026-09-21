import { describe, expect, it } from "vitest";
import { stepAt } from "./StepBreakdown";
import type { SolveStep } from "../cube/analysis";

/** Cross 0-8, a skipped pair, then three pairs, OLL and PLL. */
const steps = [
  { name: "Cross", fromMove: 0, toMove: 8 },
  { name: "F2L Slot 1", fromMove: 8, toMove: 8 },
  { name: "F2L Slot 2", fromMove: 8, toMove: 16 },
  { name: "F2L Slot 3", fromMove: 16, toMove: 22 },
  { name: "F2L Slot 4", fromMove: 22, toMove: 30 },
  { name: "OLL", fromMove: 30, toMove: 39 },
  { name: "PLL", fromMove: 39, toMove: 52 },
] as SolveStep[];

const nameAt = (index: number) => steps[stepAt(steps, index)].name;

describe("stepAt", () => {
  it("starts in the first step", () => {
    expect(nameAt(0)).toBe("Cross");
    expect(nameAt(7)).toBe("Cross");
  });

  it("moves on the moment a step's first move is reached", () => {
    // Landing on move 8 means the cross is done and the next pair is about to start.
    expect(nameAt(8)).toBe("F2L Slot 2");
    expect(nameAt(16)).toBe("F2L Slot 3");
    expect(nameAt(30)).toBe("OLL");
    expect(nameAt(39)).toBe("PLL");
  });

  it("never lands on a step that was skipped", () => {
    expect(nameAt(8)).not.toBe("F2L Slot 1");
  });

  it("stays on the last step once the solve is over", () => {
    expect(nameAt(52)).toBe("PLL");
    expect(nameAt(99)).toBe("PLL");
  });
});
