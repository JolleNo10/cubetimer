import { describe, expect, it } from "vitest";
import { formatComparisonDelta } from "./SolveComparison";

describe("formatComparisonDelta", () => {
  it("reports an exact match as neutral", () => {
    expect(formatComparisonDelta(0)).toEqual({ text: "0.00", direction: "same" });
  });

  it("treats a delta that rounds to zero as neutral", () => {
    expect(formatComparisonDelta(4)).toEqual({ text: "0.00", direction: "same" });
  });

  it("labels positive and negative displayed deltas", () => {
    expect(formatComparisonDelta(350)).toEqual({ text: "+0.35", direction: "slower" });
    expect(formatComparisonDelta(-220)).toEqual({ text: "-0.22", direction: "faster" });
  });
});
