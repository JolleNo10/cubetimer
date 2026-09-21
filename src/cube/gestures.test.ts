import { describe, expect, it } from "vitest";
import { isRecentreGesture } from "./gestures";

describe("isRecentreGesture", () => {
  it("recognises three turns of the top face", () => {
    expect(isRecentreGesture(["U", "U", "U"])).toBe(true);
    expect(isRecentreGesture(["U'", "U'", "U'"])).toBe(true);
  });

  it("only looks at the most recent turns", () => {
    expect(isRecentreGesture(["R", "F'", "U", "U", "U"])).toBe(true);
  });

  it("wants them all the same way round", () => {
    expect(isRecentreGesture(["U", "U'", "U"])).toBe(false);
    expect(isRecentreGesture(["U'", "U", "U"])).toBe(false);
  });

  it("wants the top face, and only quarter turns", () => {
    expect(isRecentreGesture(["D", "D", "D"])).toBe(false);
    expect(isRecentreGesture(["U", "U", "R"])).toBe(false);
    // A cube reports quarter turns, so a written half turn is not part of a gesture.
    expect(isRecentreGesture(["U2", "U2", "U2"])).toBe(false);
  });

  it("wants three of them", () => {
    expect(isRecentreGesture(["U", "U"])).toBe(false);
    expect(isRecentreGesture([])).toBe(false);
  });

  it("is not something a scramble could ask for", () => {
    // Generated scrambles never turn one face twice in a row.
    expect(isRecentreGesture(["U", "R", "U"])).toBe(false);
  });
});
