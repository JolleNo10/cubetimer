import { describe, expect, it } from "vitest";
import { averageOf, bestAverage, formatTime, meanOf } from "./stats";
import type { Penalty, Solve } from "./types";

function solve(rawMs: number, penalty: Penalty = "none"): Solve {
  return {
    id: String(Math.random()),
    sessionId: "s",
    createdAt: 0,
    rawMs,
    penalty,
    scramble: "",
    event: "333",
    source: "keyboard",
    moves: [],
  };
}

describe("averageOf", () => {
  it("trims the best and worst", () => {
    const solves = [10, 12, 14, 16, 100].map((s) => solve(s * 1000));
    // Drops 10 and 100, means 12/14/16.
    expect(averageOf(solves, 5)).toBe(14000);
  });

  it("needs a full window", () => {
    expect(averageOf([solve(1000)], 5)).toBeUndefined();
  });

  it("drops a single DNF as the worst result", () => {
    const solves = [
      solve(10000),
      solve(12000),
      solve(14000),
      solve(16000),
      solve(20000, "DNF"),
    ];
    // DNF takes the slow slot, 10 is trimmed as the fast one.
    expect(averageOf(solves, 5)).toBe(14000);
  });

  it("is a DNF with two or more DNFs", () => {
    const solves = [
      solve(10000),
      solve(12000),
      solve(14000),
      solve(16000, "DNF"),
      solve(20000, "DNF"),
    ];
    expect(averageOf(solves, 5)).toBeNull();
  });

  it("counts +2 in the time", () => {
    const solves = [10, 12, 14, 16, 18].map((s) => solve(s * 1000));
    solves[2].penalty = "+2";
    expect(averageOf(solves, 5)).toBe((12000 + 16000 + 16000) / 3);
  });

  it("only looks at the most recent window", () => {
    const solves = [100, 10, 12, 14, 16, 18].map((s) => solve(s * 1000));
    expect(averageOf(solves, 5)).toBe(14000);
  });
});

describe("meanOf", () => {
  it("does not trim", () => {
    expect(meanOf([9, 10, 11].map((s) => solve(s * 1000)), 3)).toBe(10000);
  });

  it("is a DNF if any solve is a DNF", () => {
    const solves = [solve(9000), solve(10000), solve(11000, "DNF")];
    expect(meanOf(solves, 3)).toBeNull();
  });
});

describe("bestAverage", () => {
  it("finds the best rolling window", () => {
    const solves = [20, 20, 20, 20, 20, 10, 11, 12, 13, 14].map((s) =>
      solve(s * 1000),
    );
    expect(bestAverage(solves, 5)).toBe(12000);
  });
});

describe("formatTime", () => {
  it("formats seconds and minutes", () => {
    expect(formatTime(9876)).toBe("9.88");
    expect(formatTime(62340)).toBe("1:02.34");
    expect(formatTime(3_600_000)).toBe("60:00.00");
    expect(formatTime(null)).toBe("DNF");
    expect(formatTime(undefined)).toBe("—");
  });
});
