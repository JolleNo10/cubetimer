import { describe, expect, it } from "vitest";
import { normaliseSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./types";

const withGrip = (crossColour: string, frontColour: string) =>
  normaliseSettings({ ...DEFAULT_SETTINGS, crossColour, frontColour });

describe("normaliseSettings", () => {
  it("leaves a grip that makes sense alone", () => {
    expect(withGrip("white", "green").frontColour).toBe("green");
    expect(withGrip("yellow", "red").frontColour).toBe("red");
  });

  it("picks a new front when the old one is now underneath", () => {
    expect(withGrip("green", "green").frontColour).not.toBe("green");
  });

  it("picks a new front when the old one is now opposite the bottom", () => {
    // Blue is opposite green, so it cannot face you with green underneath.
    const settings = withGrip("green", "blue");
    expect(settings.frontColour).not.toBe("blue");
    expect(["white", "red", "yellow", "orange"]).toContain(settings.frontColour);
  });

  it("leaves the setting alone when the cube is shown as scrambled", () => {
    expect(withGrip("", "green").frontColour).toBe("green");
  });
});
