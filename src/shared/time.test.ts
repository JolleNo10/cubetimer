import { describe, expect, it } from "vitest";
import { formatTime } from "./time";

describe("formatTime", () => {
  it("formats seconds and minutes", () => {
    expect(formatTime(9876)).toBe("9.88");
    expect(formatTime(62340)).toBe("1:02.34");
    expect(formatTime(3_600_000)).toBe("60:00.00");
    expect(formatTime(null)).toBe("DNF");
    expect(formatTime(undefined)).toBe("—");
  });
});

