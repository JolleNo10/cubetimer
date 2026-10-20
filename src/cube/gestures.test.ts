import { describe, expect, it } from "vitest";
import { isF2lAgainGesture, isRecentreGesture } from "./gestures";

describe("isRecentreGesture", () => {
  it.each(["U", "U'"])("recognises four %s turns, never three", move => {
    expect(isRecentreGesture(Array(4).fill(move))).toBe(true);
    expect(isRecentreGesture(Array(3).fill(move))).toBe(false);
    expect(isRecentreGesture(["R", ...Array(4).fill(move)])).toBe(true);
  });
  it.each([
    [], ["U", "U", "U'", "U"], ["U", "R", "U", "U"],
    ["U2", "U2", "U2", "U2"], ["D", "D", "D", "D"],
  ])("rejects incomplete or invalid sequence %j", (...moves) => {
    expect(isRecentreGesture(moves)).toBe(false);
  });
});

describe("isF2lAgainGesture", () => {
  it("recognises four same-direction quarter turns of the down face", () => {
    expect(isF2lAgainGesture(["D", "D", "D", "D"])).toBe(true);
    expect(isF2lAgainGesture(["D'", "D'", "D'", "D'"])).toBe(true);
  });

  it("rejects incomplete, mixed, interrupted, and half-turn sequences", () => {
    expect(isF2lAgainGesture(["D", "D", "D"])).toBe(false);
    expect(isF2lAgainGesture(["D", "D'", "D", "D"])).toBe(false);
    expect(isF2lAgainGesture(["D", "R", "D", "D", "D"])).toBe(false);
    expect(isF2lAgainGesture(["D2", "D2", "D2", "D2"])).toBe(false);
  });
});
