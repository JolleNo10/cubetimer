import { describe, expect, it } from "vitest";
import { STEP_NAMES, type SolveAnalysis } from "../cube/analysis";
import {
  averageOf,
  bestAverage,
  countedSolves,
  compareSolveToHistory,
  formatTime,
  isSlowSolve,
  meanOf,
  sessionStats,
} from "./stats";
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

function analysedSolve(
  id: string,
  times: number[],
  options: Partial<Solve> = {},
): Solve {
  return {
    ...solve(10_000),
    id,
    analysis: {
      method: "CFOP",
      steps: STEP_NAMES.map((name, index) => ({ name, timeMs: times[index] ?? 0 })),
    } as unknown as SolveAnalysis,
    ...options,
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

describe("slow solves", () => {
  it("are left out of every figure", () => {
    const timed = [10, 12, 14, 16, 18].map((s) => solve(s * 1000));
    const withPractice = [
      ...timed.slice(0, 2),
      { ...solve(90_000), practice: true },
      ...timed.slice(2),
      { ...solve(1_000), practice: true },
    ];
    // A very slow practice solve must not drag the average, nor a fast one become a PB.
    expect(sessionStats(withPractice).ao5).toBe(sessionStats(timed).ao5);
    expect(sessionStats(withPractice).best).toBe(10_000);
    expect(sessionStats(withPractice).count).toBe(5);
  });

  it("are the only thing countedSolves removes", () => {
    const solves = [solve(1000), { ...solve(2000), practice: true }, solve(3000, "DNF")];
    expect(countedSolves(solves)).toHaveLength(2);
  });

  it("does not classify a replay as a slow solve even in slow mode", () => {
    expect(isSlowSolve({ practice: true, slowSolve: true, replay: true })).toBe(false);
  });
});

describe("compareSolveToHistory", () => {
  const currentTimes = [10, 20, 30, 40, 50, 60, 70];

  it("uses only solves before the current solve", () => {
    const before = [
      analysedSolve("before-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("before-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("before-3", [300, ...currentTimes.slice(1)]),
    ];
    const current = analysedSolve("current", currentTimes);
    const after = analysedSolve("after", [900, ...currentTimes.slice(1)]);

    const comparison = compareSolveToHistory(current, [...before, current, after]);

    expect(comparison?.sampleSize).toBe(3);
    expect(comparison?.steps[0]).toEqual({
      name: "Cross",
      currentMs: 10,
      baselineMs: 200,
      deltaMs: -190,
      skipped: false,
    });
  });

  it("marks a skipped current step without changing its baseline", () => {
    const previous = [
      analysedSolve("before-1", currentTimes),
      analysedSolve("before-2", currentTimes),
      analysedSolve("before-3", currentTimes),
    ];
    const current = analysedSolve("current", currentTimes);
    current.analysis!.steps[1].skipped = true;

    const comparison = compareSolveToHistory(current, [...previous, current]);

    expect(comparison?.steps[1]).toMatchObject({
      name: "F2L Slot 1",
      currentMs: 20,
      baselineMs: 20,
      deltaMs: 0,
      skipped: true,
    });
  });

  it("limits the baseline to the latest 20 comparable solves", () => {
    const previous = Array.from({ length: 21 }, (_, index) =>
      analysedSolve(`solve-${index}`, [(index + 1) * 1000, ...currentTimes.slice(1)]));
    const current = analysedSolve("current", currentTimes);

    const comparison = compareSolveToHistory(current, [...previous, current]);

    expect(comparison?.sampleSize).toBe(20);
    expect(comparison?.steps[0].baselineMs).toBe(11_500);
  });

  it("excludes replay solves from the baseline", () => {
    const valid = [
      analysedSolve("valid-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("valid-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("valid-3", [300, ...currentTimes.slice(1)]),
    ];
    const replay = analysedSolve("replay", [9_000, ...currentTimes.slice(1)], { replay: true });
    const current = analysedSolve("current", currentTimes);

    const comparison = compareSolveToHistory(current, [...valid, replay, current]);

    expect(comparison?.sampleSize).toBe(3);
    expect(comparison?.steps[0].baselineMs).toBe(200);
  });

  it("compares a replay current solve against ordinary prior solves", () => {
    const previous = [
      analysedSolve("normal-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("normal-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("normal-3", [300, ...currentTimes.slice(1)]),
    ];
    const current = analysedSolve("replay-current", currentTimes, { replay: true });

    const comparison = compareSolveToHistory(current, [...previous, current]);

    expect(comparison?.sampleSize).toBe(3);
    expect(comparison?.steps[0].baselineMs).toBe(200);
  });

  it("separates normal and slow-solve baselines", () => {
    const normal = [
      analysedSolve("normal-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("normal-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("normal-3", [300, ...currentTimes.slice(1)]),
    ];
    const slow = [
      analysedSolve("slow-1", [900, ...currentTimes.slice(1)], { slowSolve: true }),
      analysedSolve("slow-2", [1_000, ...currentTimes.slice(1)], { slowSolve: true }),
      analysedSolve("slow-3", [1_100, ...currentTimes.slice(1)], { slowSolve: true }),
    ];
    const normalCurrent = analysedSolve("normal-current", currentTimes);
    const slowCurrent = analysedSolve("slow-current", currentTimes, { slowSolve: true });

    expect(compareSolveToHistory(normalCurrent, [...normal, ...slow, normalCurrent])?.steps[0].baselineMs)
      .toBe(200);
    expect(compareSolveToHistory(slowCurrent, [...normal, ...slow, slowCurrent])?.steps[0].baselineMs)
      .toBe(1_000);
  });

  it("uses the legacy practice flag as the slow-solve fallback", () => {
    const previous = [
      analysedSolve("slow-1", [100, ...currentTimes.slice(1)], { practice: true }),
      analysedSolve("slow-2", [200, ...currentTimes.slice(1)], { practice: true }),
      analysedSolve("slow-3", [300, ...currentTimes.slice(1)], { practice: true }),
    ];
    const current = analysedSolve("current", currentTimes, { practice: true });

    expect(isSlowSolve(current)).toBe(true);
    expect(compareSolveToHistory(current, [...previous, current])?.steps[0].baselineMs).toBe(200);
  });

  it("ignores solves without analysis", () => {
    const previous = [
      analysedSolve("valid-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("valid-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("valid-3", [300, ...currentTimes.slice(1)]),
      { ...solve(10_000), id: "missing-analysis", analysis: null },
    ];
    const current = analysedSolve("current", currentTimes);

    expect(compareSolveToHistory(current, [...previous, current])?.sampleSize).toBe(3);
  });

  it("filters incompatible event and analysis method data", () => {
    const valid = [
      analysedSolve("valid-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("valid-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("valid-3", [300, ...currentTimes.slice(1)]),
    ];
    const otherEvent = analysedSolve("other-event", [9_000, ...currentTimes.slice(1)], { event: "222" });
    const otherMethod = analysedSolve("other-method", [8_000, ...currentTimes.slice(1)], {
      analysis: {
        method: "OTHER",
        steps: STEP_NAMES.map((name, index) => ({ name, timeMs: currentTimes[index] })),
      } as unknown as SolveAnalysis,
    });
    const current = analysedSolve("current", currentTimes);

    const comparison = compareSolveToHistory(current, [...valid, otherEvent, otherMethod, current]);

    expect(comparison?.sampleSize).toBe(3);
    expect(comparison?.steps[0].baselineMs).toBe(200);
  });

  it("requires at least three comparable solves", () => {
    const previous = [
      analysedSolve("valid-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("valid-2", [200, ...currentTimes.slice(1)]),
    ];
    const current = analysedSolve("current", currentTimes);

    expect(compareSolveToHistory(current, [...previous, current])).toBeNull();
  });

  it("uses the median for odd and even sample counts", () => {
    const odd = [100, 200, 900].map((time, index) =>
      analysedSolve(`odd-${index}`, [time, ...currentTimes.slice(1)]));
    const even = [100, 200, 900, 1_000].map((time, index) =>
      analysedSolve(`even-${index}`, [time, ...currentTimes.slice(1)]));
    const oddCurrent = analysedSolve("odd-current", currentTimes);
    const evenCurrent = analysedSolve("even-current", currentTimes);

    expect(compareSolveToHistory(oddCurrent, [...odd, oddCurrent])?.steps[0].baselineMs).toBe(200);
    expect(compareSolveToHistory(evenCurrent, [...even, evenCurrent])?.steps[0].baselineMs).toBe(550);
  });

  it("returns deltas as current minus baseline", () => {
    const previous = [1000, 2000, 3000].map((time, index) =>
      analysedSolve(`previous-${index}`, [time, ...currentTimes.slice(1)]));
    const current = analysedSolve("current", [5000, ...currentTimes.slice(1)]);

    expect(compareSolveToHistory(current, [...previous, current])?.steps[0].deltaMs).toBe(3000);
  });

  it("preserves CFOP step order", () => {
    const previous = [1, 2, 3].map((_, index) => analysedSolve(`previous-${index}`, currentTimes));
    const current = analysedSolve("current", currentTimes);

    expect(compareSolveToHistory(current, [...previous, current])?.steps.map((step) => step.name))
      .toEqual(STEP_NAMES);
  });
});
