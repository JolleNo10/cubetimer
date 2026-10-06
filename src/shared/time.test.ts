import { describe, expect, it } from "vitest";
import { formatTime, formatDate, formatDateTime, normaliseTimeZone } from "./time";

describe("formatTime", () => {
  it("formats seconds and minutes", () => {
    expect(formatTime(9876)).toBe("9.88");
    expect(formatTime(62340)).toBe("1:02.34");
    expect(formatTime(3_600_000)).toBe("60:00.00");
    expect(formatTime(null)).toBe("DNF");
    expect(formatTime(undefined)).toBe("—");
  });
});

describe("calendar timestamp formatting", () => {
  const at = new Date(2026, 9, 6, 14, 5, 9).getTime();
  it.each([
    ["dd/mm/yyyy", "06/10/2026"], ["mm/dd/yyyy", "10/06/2026"],
    ["yyyy-mm-dd", "2026-10-06"], ["dd.mm.yyyy", "06.10.2026"],
  ] as const)("formats %s in local time", (format, expected) => {
    expect(formatDate(at, format)).toBe(expected);
  });
  it("preserves browser defaults", () => {
    expect(formatDateTime(at, { dateFormat: "locale", timeFormat: "locale" })).toBe(new Date(at).toLocaleString());
  });
  it("supports independent date and clock choices with padded fields", () => {
    expect(formatDateTime(at, { dateFormat: "yyyy-mm-dd", timeFormat: "24h" })).toBe("2026-10-06, 14:05:09");
    expect(formatDateTime(at, { dateFormat: "dd/mm/yyyy", timeFormat: "12h" })).toBe("06/10/2026, 2:05:09 PM");
    for (const [hour, expected] of [[0, "12:05:09 AM"], [12, "12:05:09 PM"]] as const) {
      expect(formatDateTime(new Date(2026, 9, 6, hour, 5, 9).getTime(), { dateFormat: "yyyy-mm-dd", timeFormat: "12h" })).toBe(`2026-10-06, ${expected}`);
    }
  });
});

describe("UTC storage and time zone presentation", () => {
  const preferences = { dateFormat: "yyyy-mm-dd", timeFormat: "24h" } as const;
  it("converts one UTC instant across day boundaries without changing it", () => {
    const at = Date.UTC(2026, 0, 1, 0, 30, 9);
    expect(formatDateTime(at, { ...preferences, timeZone: "UTC" })).toBe("2026-01-01, 00:30:09");
    expect(formatDateTime(at, { ...preferences, timeZone: "America/New_York" })).toBe("2025-12-31, 19:30:09");
    expect(formatDate(at, "dd/mm/yyyy", "America/New_York")).toBe("31/12/2025");
    expect(at).toBe(Date.UTC(2026, 0, 1, 0, 30, 9));
  });
  it("uses the selected zone's daylight saving rules", () => {
    expect(formatDateTime(Date.UTC(2026, 0, 6, 12), { ...preferences, timeZone: "Europe/Oslo" })).toBe("2026-01-06, 13:00:00");
    expect(formatDateTime(Date.UTC(2026, 6, 6, 12), { ...preferences, timeZone: "Europe/Oslo" })).toBe("2026-07-06, 14:00:00");
  });
  it("auto-detects when unset and validates saved zone names", () => {
    const at = Date.UTC(2026, 9, 6, 14, 30);
    expect(formatDateTime(at, { dateFormat: "locale", timeFormat: "locale", timeZone: "" })).toBe(new Date(at).toLocaleString());
    expect(normaliseTimeZone("Europe/Oslo")).toBe("Europe/Oslo");
    expect(normaliseTimeZone("UTC")).toBe("UTC");
    for (const invalid of [undefined, null, "", "Unknown/Zone", 5]) expect(normaliseTimeZone(invalid)).toBe("");
  });
});
