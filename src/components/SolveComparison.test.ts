import { describe, expect, it } from "vitest";
import { formatComparisonDelta } from "./SolveComparison";

describe("formatComparisonDelta", () => {
  it("reports an exact match as neutral", () => {
    expect(formatComparisonDelta(0)).toEqual({ text: "0.00s", direction: "same" });
  });

  it("treats a delta that rounds to zero as neutral", () => {
    expect(formatComparisonDelta(4)).toEqual({ text: "0.00s", direction: "same" });
  });

  it("labels positive and negative displayed deltas", () => {
    expect(formatComparisonDelta(350)).toEqual({ text: "+0.35s", direction: "slower" });
    expect(formatComparisonDelta(-220)).toEqual({ text: "-0.22s", direction: "faster" });
  });
});
