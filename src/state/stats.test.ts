import { describe, expect, it } from "vitest";
import { STEP_NAMES, type SolveAnalysis } from "../cube/analysis";
import {
  averageOf,
  averageWindow,
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
  it.each([5, 12, 50, 100])("keeps numeric Ao%i behavior and explains exact trims", (size) => {
    const items = Array.from({ length: size + 3 }, (_, index) => ({ ...solve((index + 1) * 1000), id: `s${index}` }));
    const window = averageWindow(items, size)!;
    expect(window.value).toBe(((4 + size + 3) / 2) * 1000);
    expect(window.value).toBe(averageOf(items, size));
    expect(window.entries.map((entry) => entry.solveId)).toEqual(items.slice(3).map((item) => item.id));
    expect(window.entries[0].trim).toBe("best");
    expect(window.entries.at(-1)?.trim).toBe("worst");
    items.at(-1)!.penalty = "DNF";
    expect(averageWindow(items, size)!.value).toBe(averageOf(items, size));
    expect(averageWindow(items, size)!.entries.at(-1)).toMatchObject({ time: null, trim: "worst", causesDnf: false });
    items.at(-2)!.penalty = "DNF";
    const dnf = averageWindow(items, size)!;
    expect(dnf.value).toBeNull();
    expect(dnf.entries.at(-2)).toMatchObject({ time: null, trim: "kept", causesDnf: true });
  });

  it("trims deterministic distinct members when times tie", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ ...solve(1000), id: `s${index}` }));
    expect(averageWindow(items, 5)!.entries.map((entry) => entry.trim)).toEqual(["best", "kept", "kept", "kept", "worst"]);
  });

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

  it.each([5, 12, 50, 100])("matches the existing rolling Ao%i values with normal and DNF history", (size) => {
    for (const withDnfs of [false, true]) {
      const solves = Array.from({ length: 125 }, (_, index) =>
        solve(10_000 + (index * 337) % 8_000, withDnfs && (index === 0 || index === 1 || index === 70) ? "DNF" : "none"));
      const achieved = Array.from({ length: solves.length - size + 1 }, (_, index) =>
        averageOf(solves.slice(0, size + index), size))
        .filter((average): average is number => typeof average === "number");
      expect(bestAverage(solves, size)).toBe(achieved.length ? Math.min(...achieved) : undefined);
    }
  });

  it("ignores DNF windows and returns unavailable when none are achieved", () => {
    const solves = [solve(10_000), solve(12_000), solve(14_000), solve(16_000, "DNF"), solve(18_000, "DNF")];
    expect(bestAverage(solves, 5)).toBeUndefined();
    solves.push(solve(20_000), solve(22_000), solve(24_000), solve(26_000));
    expect(bestAverage(solves, 5)).toBe(24_000);
    expect(bestAverage(solves.slice(0, 4), 5)).toBeUndefined();
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

  it("uses every persisted practice/replay/slow flag for ordinary statistics", () => {
    const solves = [
      solve(1000),
      { ...solve(2000), practice: true },
      { ...solve(3000), replay: true },
      { ...solve(4000), slowSolve: true },
      solve(5000, "DNF"),
    ];
    expect(countedSolves(solves)).toHaveLength(2);
    expect(countedSolves(solves).some((item) => item.penalty === "DNF")).toBe(true);
  });

  it("does not classify a replay as a slow solve even in slow mode", () => {
    expect(isSlowSolve({ practice: true, slowSolve: true, replay: true })).toBe(false);
  });
});

describe("session long averages", () => {
  const repeats = (count: number, ms = 10_000) => Array.from({ length: count }, () => solve(ms));

  it("requires 10 finished counted solves, not just 10 results", () => {
    const stats = sessionStats([...repeats(9), solve(1000, "DNF"), { ...solve(1000), practice: true }]);
    expect(stats.ao50).toEqual({ value: undefined, status: "unavailable", count: 10, size: 50 });
    expect(stats.ao100).toEqual({ value: undefined, status: "unavailable", count: 10, size: 100 });
    expect(sessionStats([]).ao50.status).toBe("unavailable");
  });

  it("projects both long averages at 10 finished solves", () => {
    const stats = sessionStats(repeats(10));
    expect(stats.ao50).toEqual({ value: 10_000, status: "projected", count: 10, size: 50 });
    expect(stats.ao100).toEqual({ value: 10_000, status: "projected", count: 10, size: 100 });
  });

  it("uses the recent median rather than a mean distorted by outliers", () => {
    const real = [solve(1000), ...repeats(8), solve(100_000)];
    for (const size of [50, 100] as const) {
      expect(sessionStats(real)[size === 50 ? "ao50" : "ao100"].value)
        .toBe(averageOf([...real, ...repeats(size - real.length)], size));
    }
  });

  it("uses only the latest 20 finished solves for future pace, retaining older real results", () => {
    const recent = Array.from({ length: 20 }, (_, index) => solve((10 + index) * 1000));
    for (const olderMs of [1000, 100_000]) {
      const real = [...repeats(5, olderMs), ...recent];
      const stats = sessionStats(real);
      // Latest 20 have median 19.5s regardless of the five older results.
      expect(stats.ao50.value).toBe(averageOf([...real, ...repeats(25, 19_500)], 50));
      expect(stats.ao100.value).toBe(averageOf([...real, ...repeats(75, 19_500)], 100));
    }
  });

  it("applies +2 to real results and the even-sample median baseline", () => {
    const real = [...repeats(5), ...repeats(5).map((s) => ({ ...s, penalty: "+2" as const }))];
    expect(sessionStats(real).ao50.value)
      .toBe(averageOf([...real, ...repeats(40, 11_000)], 50));
    expect(sessionStats(real).mean).toBe(11_000);
  });

  it("excludes DNFs from future pace but keeps them in the projected average", () => {
    const real = [...repeats(10), solve(100_000, "DNF")];
    expect(sessionStats(real).ao50.value).toBe(averageOf([...real, ...repeats(39)], 50));
    expect(sessionStats(real).ao50.value).toBe(10_000);
    const twoDnfs = [...real, solve(1000, "DNF")];
    for (const size of [50, 100] as const) {
      const projected = sessionStats(twoDnfs)[size === 50 ? "ao50" : "ao100"];
      expect(projected.status).toBe("projected");
      expect(projected.value).toBe(averageOf([...twoDnfs, ...repeats(size - 12)], size));
      expect(projected.value).toBeNull();
    }
  });

  it("selects the latest finished results even when newer results are DNFs", () => {
    const real = [...repeats(10, 90_000), ...repeats(20), solve(1000, "DNF")];
    expect(sessionStats(real).ao50.value).toBe(averageOf([...real, ...repeats(19)], 50));
  });

  it("excludes slow/practice and replay recordings from count, baseline and averages", () => {
    const real = repeats(10);
    const excluded = [
      { ...solve(90_000), practice: true, slowSolve: true },
      { ...solve(1000), practice: true, replay: true },
    ];
    expect(sessionStats([...real, ...excluded])).toEqual(sessionStats(real));
  });

  it.each([50, 64, 99])("has an actual Ao50 and projected Ao100 at %i counted solves", (count) => {
    const real = Array.from({ length: count }, (_, index) => solve((index + 1) * 1000));
    const stats = sessionStats(real);
    expect(stats.ao50).toEqual({ value: averageOf(real, 50), status: "actual", count: 50, size: 50 });
    expect(stats.ao100.status).toBe("projected");
    expect(stats.ao100.count).toBe(count);
    const baseline = (count - 9.5) * 1000;
    expect(stats.ao100.value).toBe(averageOf([...real, ...repeats(100 - count, baseline)], 100));
  });

  it.each([100, 105])("uses actual rolling long averages and caps progress at %i solves", (count) => {
    const real = Array.from({ length: count }, (_, index) => solve((index + 1) * 1000));
    const stats = sessionStats(real);
    expect(stats.ao50).toEqual({ value: averageOf(real, 50), status: "actual", count: 50, size: 50 });
    expect(stats.ao100).toEqual({ value: averageOf(real, 100), status: "actual", count: 100, size: 100 });
  });

  it("preserves current and best short averages, best single and DNF session mean", () => {
    const real = [...repeats(12), ...repeats(12, 20_000)];
    const stats = sessionStats(real);
    expect(stats).toMatchObject({ ao5: 20_000, ao12: 20_000, bestAo5: 10_000, bestAo12: 10_000, best: 10_000, mean: 15_000 });
    expect(sessionStats([...real, solve(1000, "DNF")]).mean).toBeNull();
    // A different session's array alone defines every statistic; no retained history.
    expect(sessionStats(repeats(10, 30_000))).toMatchObject({ count: 10, best: 30_000, mean: 30_000 });
  });
});

describe("analysed session statistics", () => {
  function withMetrics(times: number[], turns = 50, solvingMs = 10_000, recognitionMs = 2000): Solve {
    const result = analysedSolve("analysed", times);
    Object.assign(result.analysis!, {
      sliceTurns: turns, solvingMs, totalRecognitionMs: recognitionMs, totalExecutionMs: solvingMs - recognitionMs, pauses: [],
      steps: result.analysis!.steps.map((step, index) => ({ ...step, recognitionMs: 0, executionMs: step.timeMs, sliceTurns: 2, skipped: false, fromMove: index * 2, toMove: index * 2 + 2 })),
    });
    return result;
  }

  it("uses analysed slice turns, aggregate solving time and mean recognition", () => {
    const first = withMetrics([1000, 1000, 1000, 1000, 1000, 2000, 3000], 40, 10_000, 2000);
    const second = withMetrics([1000, 2000, 2000, 2000, 2000, 3000, 8000], 60, 20_000, 4000);
    // Both raw move arrays are empty and both raw durations are 10s.
    expect(sessionStats([first, second]).solving).toEqual({
      sampleSize: 2, meanMoves: 50, aggregateTps: 100 / 30, meanRecognitionMs: 3000,
    });
  });

  it("sums all F2L slots per solve before taking medians and preserves phase order", () => {
    const real = [
      withMetrics([1000, 100, 0, 0, 0, 3000, 4000]),
      withMetrics([2000, 0, 100, 0, 0, 1000, 6000]),
      withMetrics([9000, 0, 0, 100, 0, 2000, 5000]),
    ];
    expect(sessionStats(real).cfop).toEqual([
      { name: "Cross", timeMs: 2000 },
      { name: "F2L", timeMs: 100 }, // Sum of individual slot medians would incorrectly be zero.
      { name: "OLL", timeMs: 2000 },
      { name: "PLL", timeMs: 5000 },
    ]);
    expect(sessionStats(real.slice(0, 2)).cfop?.[0].timeMs).toBe(1500);
  });

  it("uses only finished normal solves with usable canonical CFOP analyses", () => {
    const valid = withMetrics([100, 200, 300, 400, 500, 600, 700]);
    const invalid = [
      { ...valid, practice: true },
      { ...valid, slowSolve: true },
      { ...valid, replay: true },
      { ...valid, penalty: "DNF" as const },
      { ...valid, analysis: null },
      { ...valid, analysis: { ...valid.analysis!, method: "OTHER" } as unknown as SolveAnalysis },
      { ...valid, analysis: { ...valid.analysis!, steps: valid.analysis!.steps.slice(1) } },
      { ...valid, analysis: { ...valid.analysis!, steps: [...valid.analysis!.steps].reverse() } },
      { ...valid, analysis: { ...valid.analysis!, solvingMs: 0 } },
      { ...valid, analysis: { ...valid.analysis!, sliceTurns: NaN } },
      { ...valid, analysis: { ...valid.analysis!, totalRecognitionMs: -1 } },
      { ...valid, analysis: { ...valid.analysis!, steps: valid.analysis!.steps.map((step) => ({ ...step, timeMs: Infinity })) } },
    ];
    expect(sessionStats([valid, ...invalid]).solving).toEqual(sessionStats([valid]).solving);
    expect(sessionStats([valid, ...invalid]).cfop).toEqual(sessionStats([valid]).cfop);
    expect(sessionStats(invalid).solving).toBeUndefined();
    expect(sessionStats(invalid).cfop).toBeUndefined();
  });

  it("omits solving and CFOP sections without analysed data", () => {
    expect(sessionStats([solve(10_000)]).solving).toBeUndefined();
    expect(sessionStats([solve(10_000)]).cfop).toBeUndefined();
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

  it("filters other sessions and incompatible analysis method data", () => {
    const valid = [
      analysedSolve("valid-1", [100, ...currentTimes.slice(1)]),
      analysedSolve("valid-2", [200, ...currentTimes.slice(1)]),
      analysedSolve("valid-3", [300, ...currentTimes.slice(1)]),
    ];
    const otherSession = analysedSolve("other-session", [9_000, ...currentTimes.slice(1)], {
      sessionId: "other-session",
    });
    const otherMethod = analysedSolve("other-method", [8_000, ...currentTimes.slice(1)], {
      analysis: {
        method: "OTHER",
        steps: STEP_NAMES.map((name, index) => ({ name, timeMs: currentTimes[index] })),
      } as unknown as SolveAnalysis,
    });
    const current = analysedSolve("current", currentTimes);

    const comparison = compareSolveToHistory(current, [...valid, otherSession, otherMethod, current]);

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
