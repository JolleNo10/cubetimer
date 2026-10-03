import { describe, expect, it } from "vitest";
import type { SolveAnalysis, SolveStep } from "../../../cube/analysis";
import { replayStickeringMask } from "./replayFocus";

const f2lStep = (
  name: SolveStep["name"],
  slot: string | null,
  overrides: Partial<SolveStep> = {},
) => ({ name, slot, skipped: false, ...overrides } as SolveStep);

const analysis = (
  crossFace: SolveAnalysis["crossFace"],
  steps: SolveStep[],
) => ({ crossFace, steps } as SolveAnalysis);

describe("replayStickeringMask", () => {
  it("uses the normal mask for Cross", () => {
    const name = "Cross" as const;
    expect(replayStickeringMask(
      analysis("D", [f2lStep(name, null)]),
      0,
    )).toBe(
      "EDGES:------------,CORNERS:--------,CENTERS:------",
    );
  });

  it.each(["OLL", "PLL"] as const)(
    "focuses the last layer during %s on a D cross",
    (name) => {
      expect(replayStickeringMask(
        analysis("D", [f2lStep(name, null)]),
        0,
      )).toBe(
        "EDGES:----DDDDDDDD,CORNERS:----DDDD,CENTERS:-DDDDD",
      );
    },
  );

  it("uses the normal mask when an F2L slot is missing", () => {
    expect(replayStickeringMask(
      analysis("D", [f2lStep("F2L Slot 1", null)]),
      0,
    )).toBe(
      "EDGES:------------,CORNERS:--------,CENTERS:------",
    );
  });

  it("keeps the cross visible while focusing the current and next D-cross pairs", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", "BR"),
      ]),
      0,
    )).toBe(
      "EDGES:IIIIDDDD-IDI,CORNERS:IIII-IID,CENTERS:DDDDDD",
    );
  });

  it("keeps previously solved pairs visible while focusing the active pair", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", "BR"),
        f2lStep("F2L Slot 3", "BL"),
        f2lStep("F2L Slot 4", "FL"),
      ]),
      3,
    )).toBe(
      "EDGES:IIIIDDDDD-DD,CORNERS:IIIID-DD,CENTERS:DDDDDD",
    );
  });

  it("keeps a skipped earlier pair visible as solved context", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR", { skipped: true }),
        f2lStep("F2L Slot 2", "BR"),
        f2lStep("F2L Slot 3", "BL"),
      ]),
      1,
    )).toBe(
      "EDGES:IIIIDDDDDI-D,CORNERS:IIIIDID-,CENTERS:DDDDDD",
    );
  });

  it("skips a future solved F2L step when selecting the next pair", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", "BR", { skipped: true }),
        f2lStep("F2L Slot 3", "BL"),
      ]),
      0,
    )).toBe(
      "EDGES:IIIIDDDD-IID,CORNERS:IIII-IDI,CENTERS:DDDDDD",
    );
  });

  it("does not invent a lookahead pair without a usable future slot", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", null),
        f2lStep("F2L Slot 3", null),
      ]),
      0,
    )).toBe(
      "EDGES:IIIIDDDD-III,CORNERS:IIII-III,CENTERS:DDDDDD",
    );
  });

  it.each(["OLL", "PLL"] as const)(
    "uses the opposite face for %s last-layer focus on a U cross",
    (name) => {
      expect(replayStickeringMask(
        analysis("U", [f2lStep(name, null)]),
        0,
      )).toBe(
        "EDGES:DDDD----DDDD,CORNERS:DDDD----,CENTERS:DDDDD-",
      );
    },
  );

  it("uses the cross face frame for non-D mappings", () => {
    expect(replayStickeringMask(
      analysis("U", [
        f2lStep("F2L Slot 1", "BR"),
      ]),
      0,
    )).toBe(
      "EDGES:DDDDIIIIII-I,CORNERS:I-IIIIII,CENTERS:DDDDDD",
    );
  });
});
