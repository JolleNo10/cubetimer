import { describe, expect, it } from "vitest";
import { rotationForGrip } from "./orientation";
import { moveGuideForToken } from "./moveGuide";

describe("guide move semantics", () => {
  it("reverses prime direction and marks a half turn as direction-independent", () => {
    expect(moveGuideForToken("R")?.direction).toBe(-1);
    expect(moveGuideForToken("R'")?.direction).toBe(1);
    for (const move of ["R2", "M2", "r2"]) expect(moveGuideForToken(move)?.halfTurn).toBe(true);
  });

  it.each(["r", "f", "Rw", "Fw"])("shows %s as two layers", (token) => {
    expect(moveGuideForToken(token)).toMatchObject({ kind: "wide", layers: [-1 / 3, 1] });
  });

  it.each(["M", "E", "S"])("shows %s as the middle slice", (token) => {
    expect(moveGuideForToken(token)).toMatchObject({ kind: "slice", layers: [-1 / 3, 1 / 3] });
  });

  it("shows an outer face and whole cube with distinct extents", () => {
    expect(moveGuideForToken("R")).toMatchObject({ kind: "outer", layers: [1 / 3, 1] });
    expect(moveGuideForToken("x")).toMatchObject({ kind: "rotation", layers: [-1, 1] });
  });
});


describe("move guide frame and notation boundary", () => {
  it.each(["invalid", "R U", "", "Q", "R0", "2R", "3Rw"])("omits unsupported %s", token => {
    expect(moveGuideForToken(token)).toBeNull();
  });

  it.each(["x", "y", "z"])("describes %s as a whole-cube rotation", token => {
    expect(moveGuideForToken(token)).toMatchObject({ kind: "rotation", axis: token, layers: [-1, 1] });
    expect(moveGuideForToken(`${token}'`)?.direction).toBe(-moveGuideForToken(token)!.direction);
  });

  it("maps layers and direction through an explicitly supplied orientation", () => {
    const orientation = rotationForGrip("R", "B")!.orientation;
    const face = orientation.R;
    expect(moveGuideForToken("R", orientation)).toEqual({ ...moveGuideForToken(face), token: "R" });
    expect(moveGuideForToken("R'", orientation)?.direction).toBe(-moveGuideForToken("R", orientation)!.direction);
    expect(moveGuideForToken("Rw", orientation)?.axis).toBe(moveGuideForToken(face)?.axis);
  });
});
