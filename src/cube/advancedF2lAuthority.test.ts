import { describe, expect, it } from "vitest";
import { ADVANCED_F2L_CASES } from "./advancedF2lCases.generated";

describe("Advanced published-state authority", () => {
  it.each([
    ["AF2L 1", "S R S'", "BR"],
    ["AF2L 2", "L U2' L' R U R'", "BL"],
    ["AF2L 3", "L F' L' F U' R U R'", "FL"],
  ])("%s preserves the published setup and intended canonical target", (name, setup, canonicalTarget) => {
    expect(ADVANCED_F2L_CASES.find((entry) => entry.name === name)).toMatchObject({ setup, canonicalTarget });
  });
});
