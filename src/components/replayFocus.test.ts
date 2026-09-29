import { describe, expect, it } from "vitest";
import type { SolveAnalysis, SolveStep } from "../cube/analysis";
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
  it.each(["Cross", "OLL", "PLL"] as const)(
    "uses the normal mask for %s",
    (name) => {
      expect(replayStickeringMask(
        analysis("D", [f2lStep(name, null)]),
        0,
      )).toBe(
        "EDGES:------------,CORNERS:--------,CENTERS:------",
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

  it("highlights the current pair and dims the next pair on a D cross", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", "BR"),
      ]),
      0,
    )).toBe(
      "EDGES:IIIIIIII-IDI,CORNERS:IIII-IID,CENTERS:IIIIII",
    );
  });

  it("mutes all other pieces when the last F2L pair is active", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", "BR"),
        f2lStep("F2L Slot 3", "BL"),
        f2lStep("F2L Slot 4", "FL"),
      ]),
      3,
    )).toBe(
      "EDGES:IIIIIIIII-II,CORNERS:IIIII-II,CENTERS:IIIIII",
    );
  });

  it("skips a solved F2L step when selecting the next pair", () => {
    expect(replayStickeringMask(
      analysis("D", [
        f2lStep("F2L Slot 1", "FR"),
        f2lStep("F2L Slot 2", "BR", { skipped: true }),
        f2lStep("F2L Slot 3", "BL"),
      ]),
      0,
    )).toBe(
      "EDGES:IIIIIIII-IID,CORNERS:IIII-IDI,CENTERS:IIIIII",
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
      "EDGES:IIIIIIII-III,CORNERS:IIII-III,CENTERS:IIIIII",
    );
  });

  it("uses the cross face frame for non-D mappings", () => {
    expect(replayStickeringMask(
      analysis("U", [
        f2lStep("F2L Slot 1", "BR"),
      ]),
      0,
    )).toBe(
      "EDGES:IIIIIIIIII-I,CORNERS:I-IIIIII,CENTERS:IIIIII",
    );
  });
});
