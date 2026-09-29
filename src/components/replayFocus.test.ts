import { describe, expect, it } from "vitest";
import type { SolveAnalysis, SolveStep } from "../cube/analysis";
import { replayStickeringMask } from "./replayFocus";

const analysis = (crossFace: SolveAnalysis["crossFace"]) =>
  ({ crossFace } as SolveAnalysis);

const step = (overrides: Partial<SolveStep>) =>
  ({ name: "F2L Slot 1", slot: "FR", ...overrides } as SolveStep);

describe("replayStickeringMask", () => {
  it("uses the normal mask for non-F2L steps", () => {
    expect(replayStickeringMask(analysis("D"), step({ name: "OLL", slot: null }))).toBe(
      "EDGES:------------,CORNERS:--------,CENTERS:------",
    );
  });

  it("uses the normal mask when an F2L slot is missing", () => {
    expect(replayStickeringMask(analysis("D"), step({ slot: null }))).toBe(
      "EDGES:------------,CORNERS:--------,CENTERS:------",
    );
  });

  it("focuses only the D-cross FR pair", () => {
    expect(replayStickeringMask(analysis("D"), step({}))).toBe(
      "EDGES:DDDDDDDD-DDD,CORNERS:DDDD-DDD,CENTERS:DDDDDD",
    );
  });

  it("uses the cross face frame for non-D mappings", () => {
    expect(replayStickeringMask(analysis("U"), step({ slot: "BR" }))).toBe(
      "EDGES:DDDDDDDDDD-D,CORNERS:D-DDDDDD,CENTERS:DDDDDD",
    );
  });
});
