import { describe, expect, it } from "vitest";
import { STEP_NAMES, type SolveAnalysis } from "../../../cube/analysis";
import { DEFAULT_EVENT_ID } from "../../../cube/scramble";
import { averageOf } from "./stats";
import {
  deriveStatistics,
  recentPerformanceComparison,
  filterPhaseChartWindow,
  percentile,
  chartWindowSeries,
  focusCases,
  recentForm,
  sessionLocalWindows,
  sessionSegmentKeys,
  sliceChartWindow,
  sortRankingRows,
  sortCasePerformance,
  sortPerformanceRows,
  sortSolveRows,
  type StatisticsSnapshot,
} from "./statistics";
import type { Penalty, Session, Solve } from "../../../app/types";
import { analysedSolveFacts } from "./stats";

function session(id: string, event = DEFAULT_EVENT_ID, createdAt = 1): Session {
  return { id, name: id, event, createdAt };
}

function solve(
  id: string,
  sessionId: string,
  rawMs: number,
  options: Partial<Solve> = {},
): Solve {
  return {
    id,
    sessionId,
    createdAt: options.createdAt ?? Number(id.replace(/\D/g, "") || 0),
    rawMs,
    penalty: "none" as Penalty,
    scramble: "",
    source: "keyboard",
    moves: [],
    ...options,
  };
}

function analysed(id: string, sessionId: string, createdAt: number): Solve {
  return solve(id, sessionId, 10_000, {
    createdAt,
    analysis: {
      method: "CFOP",
      sliceTurns: 50,
      solvingMs: 10_000,
      totalRecognitionMs: 2_000,
      totalExecutionMs: 8_000,
      pauses: [],
      steps: STEP_NAMES.map((name, index) => ({
        name,
        timeMs: index === 1 ? 500 : index === 2 ? 500 : index === 3 ? 500 : 1_000,
        recognitionMs: index === 0 ? 0 : 200,
        executionMs: index > 0 && index < 4 ? 300 : 800,
        sliceTurns: 2, skipped: false, fromMove: index * 2, toMove: index * 2 + 2,
        case: index === 5 ? "27" : index === 6 ? "T" : null,
      })),
    } as unknown as SolveAnalysis,
  });
}

describe("recent analysed performance comparison", () => {
  it("requires five per equal chronological window and uses the latest up-to-ten plus immediately previous window", () => {
    const facts = Array.from({ length: 23 }, (_, i) => ({ ...analysedSolveFacts(analysed(`s${i}`, "A", i))!, solvingMs: i * 100,
      recognitionMs: i * 10, executionMs: i * 90, phases: { crossMs: -i * 10, f2lMs: i * 40, ollMs: i * 30, pllMs: i * 40 } }));
    expect(recentPerformanceComparison(facts.slice(0, 9))).toBeNull();
    const comparison = recentPerformanceComparison([...facts].reverse())!;
    expect(comparison.sampleSize).toBe(10);
    expect(comparison.recentSolveIds).toEqual(facts.slice(13).map(a => a.id)); expect(comparison.baselineSolveIds).toEqual(facts.slice(3, 13).map(a => a.id));
    expect(comparison).toMatchObject({ recentMedianDelta: 1000, recognitionDelta: 100, executionDelta: 900,
      crossDelta: -100, f2lDelta: 400, ollDelta: 300, pllDelta: 400, largestPositivePhaseDelta: { phase: "F2L", delta: 400 },
      largestNegativePhaseDelta: { phase: "Cross", delta: -100 }, iqrDelta: 0 });
    expect(recentPerformanceComparison(facts.slice(0, 11))?.sampleSize).toBe(5);
  });
  it("compares IQR rather than WCA averages and returns no phase extrema when unchanged", () => {
    const facts = Array.from({ length: 10 }, (_, i) => ({ ...analysedSolveFacts(analysed(`s${i}`, "A", i))!, solvingMs: i < 5 ? 1000 : 1000 + (i - 5) * 100 }));
    const comparison = recentPerformanceComparison(facts)!;
    expect(comparison.iqrDelta).toBe(200); expect(comparison.largestPositivePhaseDelta).toBeNull(); expect(comparison.largestNegativePhaseDelta).toBeNull();
  });
  it("derives within counted Event/Session scope without synthesizing All-Sessions WCA windows", () => {
    const solves = Array.from({ length: 12 }, (_, i) => analysed(`s${i}`, i < 6 ? "A" : "B", i));
    const snapshot = { sessions: [session("A"), session("B"), session("C", "222")], solves: [...solves,
      ...Array.from({ length: 10 }, (_, i) => analysed(`c${i}`, "C", 20 + i)), analysed("ignored", "A", 30)] };
    snapshot.solves.at(-1)!.practice = true;
    const all = deriveStatistics(snapshot, { event: "333", sessionId: null }, "A");
    expect(all.recentPerformance?.sampleSize).toBe(6); expect(all.recentPerformance?.recentSolveIds).toEqual(solves.slice(6).map(s => s.id));
    expect(all.records.ao12).toEqual([]);
    expect(deriveStatistics(snapshot, { event: "333", sessionId: "A" }, "A").recentPerformance).toBeNull();
    expect(deriveStatistics(snapshot, { event: "222", sessionId: null }, "A").recentPerformance?.sampleSize).toBe(5);
  });
});

describe("deriveStatistics", () => {
  it("keeps returning Session runs distinct when an intervening Session has no Ao5", () => {
    const solves = ["A", "A", "A", "A", "A", "B", "B", "B", "B", "A"].map((sessionId, index) =>
      solve(`s${index}`, sessionId, 10_000 + index * 100, { createdAt: index }));
    const result = deriveStatistics({ sessions: [session("A"), session("B")], solves }, { event: "333", sessionId: null }, null);
    expect(result.averageProgression.map((point) => point.solveId)).toEqual(["s4", "s9"]);
    const [first, returning] = result.averageProgression;
    expect(first.sessionId).toBe("A");
    expect(returning.sessionId).toBe(first.sessionId);
    expect(returning.segmentKey).not.toBe(first.segmentKey);
  });

  const snapshot: StatisticsSnapshot = {
    sessions: [session("A", "333", 1), session("B", "333", 2), session("C", "222", 3)],
    solves: [
      solve("a-2", "A", 20_000, { createdAt: 20 }),
      solve("b-1", "B", 10_000, { createdAt: 10 }),
      solve("c-1", "C", 1_000, { createdAt: 1 }),
      solve("orphan", "missing", 500, { createdAt: 30 }),
    ],
  };

  it("filters all-session history through Session.event", () => {
    const result = deriveStatistics(snapshot, { event: "333", sessionId: null }, "A");
    expect(result.scopeSolves.map((item) => item.id)).toEqual(["b-1", "a-2"]);
    expect(result.stats.count).toBe(2);
    expect(result.ignoredSolveCount).toBe(1);
    expect(result.sessionId).toBeNull();
    expect(result.sessionComparison.filter((row) => row.current).map((row) => row.session.id)).toEqual(["A"]);
  });

  it("supports an individual Session without changing external state", () => {
    const result = deriveStatistics(snapshot, { event: "333", sessionId: "A" }, "B");
    expect(result.scopeSolves.map((item) => item.sessionId)).toEqual(["A"]);
    expect(result.sessionComparison).toHaveLength(2);
    expect(result.sessionId).toBe("A");
    expect(result.sessionComparison.filter((row) => row.current).map((row) => row.session.id)).toEqual(["B"]);
  });

  it("does not mark another event's active Timer Session as current", () => {
    const result = deriveStatistics(snapshot, { event: "333", sessionId: null }, "C");
    expect(result.sessionComparison.every((row) => !row.current)).toBe(true);
  });

  it("merges Singles chronologically without inventing interleaved averages", () => {
    const solves = [
      solve("a", "A", 10_000, { createdAt: 2 }),
      solve("b", "B", 12_000, { createdAt: 1 }),
      solve("c", "A", 14_000, { createdAt: 3 }),
      solve("d", "B", 16_000, { createdAt: 4 }),
      solve("e", "A", 18_000, { createdAt: 5 }),
    ];
    const result = deriveStatistics({ sessions: [session("A"), session("B")], solves }, { event: "333", sessionId: null }, null);
    expect(result.trend.map((point) => point.id)).toEqual(["b", "a", "c", "d", "e"]);
    expect(result.trend.every((point) => point.ao5 === undefined)).toBe(true);
    expect(result.stats.ao5).toBeUndefined();
    expect(result.trend.filter((point) => point.isPb).map((point) => point.id)).toEqual(["b", "a"]);
  });

  it("keeps Ao5/Ao12 and PB semantics across bounded normal and DNF windows", () => {
    const solves = Array.from({ length: 40 }, (_, index) =>
      solve(`s${index}`, "A", 30_000 - index * 300, {
        createdAt: index,
        penalty: index === 5 || index === 6 ? "DNF" : "none",
      }));
    const result = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: null }, null);
    result.trend.forEach((point, index) => {
      expect(point.ao5).toBe(averageOf(solves.slice(0, index + 1), 5));
      expect(point.ao12).toBe(averageOf(solves.slice(0, index + 1), 12));
      expect(point.isPb).toBe(point.time !== null);
    });
    expect(result.trend[3].ao5).toBeUndefined();
    expect(result.trend[5].ao5).toBeTypeOf("number");
    expect(result.trend[6].ao5).toBeNull();
    expect(result.trend[11].ao12).toBeNull();
    expect(result.trend[18].ao12).toBeTypeOf("number");
  });

  it("applies all ordinary-statistics exclusions while retaining DNFs", () => {
    const solves = [
      solve("normal", "A", 10_000),
      solve("dnf", "A", 10_000, { penalty: "DNF" }),
      solve("practice", "A", 1_000, { practice: true }),
      solve("replay", "A", 1_000, { replay: true }),
      solve("slow", "A", 1_000, { slowSolve: true }),
    ];
    const result = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: null }, null);
    expect(result.stats.count).toBe(2);
    expect(result.dnfCount).toBe(1);
    expect(result.distribution.dnfCount).toBe(1);
    expect(result.distribution.bins.every((bin) => bin.count <= 1)).toBe(true);
  });

  it("uses deterministic interpolated percentiles", () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(percentile([1, 2, 3, 4], 0.9)).toBe(3.7);
  });

  it("sums F2L per solve and computes aggregate recognition/execution", () => {
    const result = deriveStatistics({
      sessions: [session("A")],
      solves: [analysed("one", "A", 1), analysed("two", "A", 2)],
    }, { event: "333", sessionId: null }, null);
    expect(result.analysisCount).toBe(2);
    expect(result.recognitionExecution).toMatchObject({
      sampleSize: 2,
      meanRecognitionMs: 2_000,
      recognitionMs: 4_000,
      executionMs: 16_000,
      recognitionShare: 0.2,
      executionShare: 0.8,
    });
    expect(result.cfop?.find((phase) => phase.name === "F2L")?.timeMs).toBe(2_500);
  });

  it("builds rolling median phase points and ordered session comparison", () => {
    const result = deriveStatistics({
      sessions: [session("empty", "333", 10), session("old", "333", 1), session("new", "333", 2)],
      solves: [analysed("old-solve", "old", 1), analysed("new-solve", "new", 2)],
    }, { event: "333", sessionId: null }, null);
    expect(result.phaseTrend).toHaveLength(2);
    expect(result.sessionComparison.map((row) => row.session.id)).toEqual(["new", "old", "empty"]);
  });

  it("uses validated facts for mean recognition and aggregate duration shares", () => {
    const first = analysed("first", "A", 1);
    const second = analysed("second", "A", 2);
    second.analysis = { ...second.analysis!, solvingMs: 20_000, totalRecognitionMs: 7_000, totalExecutionMs: 13_000 };
    const invalid = analysed("invalid", "A", 3);
    invalid.analysis = { ...invalid.analysis!, totalRecognitionMs: 11_000 };
    const result = deriveStatistics({ sessions: [session("A")], solves: [first, second, invalid] }, { event: "333", sessionId: null }, null);
    expect(result.analysisCount).toBe(2);
    expect(result.recognitionExecution).toMatchObject({
      sampleSize: 2,
      meanRecognitionMs: 4_500,
      recognitionMs: 9_000,
      executionMs: 21_000,
      recognitionShare: 0.3,
      executionShare: 0.7,
    });
    expect(result.phaseTrend.map((point) => point.solveId)).toEqual(["first", "second"]);
  });
});

describe("sliceChartWindow", () => {
  it("bounds only the presentation series", () => {
    expect(sliceChartWindow(Array.from({ length: 51 }, (_, index) => index), 50)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
    expect(sliceChartWindow([1, 2, 3], "all")).toEqual([1, 2, 3]);
  });
});

describe("filterPhaseChartWindow", () => {
  it("keeps sparse CFOP points inside the counted-solve display window without recomputing medians", () => {
    const solves = Array.from({ length: 101 }, (_, index) => {
      const number = index + 1;
      if (![1, 51, 76, 101].includes(number)) return solve(`s${number}`, "A", 10_000, { createdAt: number });
      const item = analysed(`s${number}`, "A", number);
      item.analysis = { ...item.analysis!, steps: item.analysis!.steps.map((step) => ({ ...step, timeMs: number * 10 })) };
      return item;
    });
    const model = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: null }, null);
    const visible = filterPhaseChartWindow(model.phaseTrend, sliceChartWindow(model.trend, 50), 50);
    expect(visible.map((point) => point.solveId)).toEqual(["s76", "s101"]);
    expect(visible[1]).toBe(model.phaseTrend[3]);
    expect(visible[1].crossMs).toBe(635);
    expect(filterPhaseChartWindow(model.phaseTrend, sliceChartWindow(model.trend, 100), 100).map((point) => point.solveId)).toEqual(["s51", "s76", "s101"]);
    expect(filterPhaseChartWindow(model.phaseTrend, sliceChartWindow(model.trend, 250), 250)).toEqual(model.phaseTrend);
    expect(filterPhaseChartWindow(model.phaseTrend, [], "all")).toEqual(model.phaseTrend);
  });
});

function modelFor(solves: Solve[]) {
  return deriveStatistics({ sessions: [session("A"), session("B")], solves }, { event: "333", sessionId: null }, "A");
}

function skipStep(solve: Solve, index: number) {
  const steps = solve.analysis!.steps;
  steps[index] = { ...steps[index], skipped: true, sliceTurns: 0, timeMs: 0, recognitionMs: 0, executionMs: 0, toMove: steps[index].fromMove, case: index >= 5 ? "Solved" : null };
  for (let next = index + 1; next < steps.length; next++) {
    const length = steps[next].toMove - steps[next].fromMove;
    steps[next] = { ...steps[next], fromMove: steps[next - 1].toMove, toMove: steps[next - 1].toMove + length };
  }
}

describe("historical records and performance", () => {
  it("sorts solve columns with real DNFs and missing facts last in either direction", () => {
    const a = analysed("analysed", "A", 2);
    const model = modelFor([solve("dnf", "A", 1, { penalty: "DNF", createdAt: 3 }), solve("missing", "B", 9000, { createdAt: 1 }), a]);
    expect(sortSolveRows(model.solveRows, "time", "asc").map((row) => row.solve.id)).toEqual(["missing", "analysed", "dnf"]);
    expect(sortSolveRows(model.solveRows, "time", "desc").map((row) => row.solve.id)).toEqual(["dnf", "analysed", "missing"]);
    for (const direction of ["asc", "desc"] as const) {
      expect(sortSolveRows(model.solveRows, "tps", direction).map((row) => row.solve.id)).toEqual(["analysed", "missing", "dnf"]);
    }
    expect(sortSolveRows(model.solveRows, "date", "desc").map((row) => row.solve.id)).toEqual(["dnf", "analysed", "missing"]);
    const ties = modelFor([solve("z", "A", 1000, { createdAt: 1 }), solve("a", "A", 1000, { createdAt: 1 })]);
    expect(sortSolveRows(ties.solveRows, "time", "desc").map((row) => row.solve.id)).toEqual(["a", "z"]);
  });

  it("distinguishes DNF average cells from unavailable windows while sorting", () => {
    const solves = Array.from({ length: 7 }, (_, index) => solve(`s${index}`, "A", 10000, { createdAt: index, penalty: index >= 5 ? "DNF" : "none" }));
    const model = modelFor(solves);
    expect(model.solveRows[3].averages.ao5).toBeUndefined();
    expect(model.solveRows[5].averages.ao5?.value).toBe(10000);
    expect(model.solveRows[6].averages.ao5?.value).toBeNull();
    expect(sortSolveRows(model.solveRows, "ao5", "asc").map((row) => row.solve.id)).toEqual(["s4", "s5", "s6", "s0", "s1", "s2", "s3"]);
    expect(sortSolveRows(model.solveRows, "ao5", "desc").map((row) => row.solve.id)).toEqual(["s6", "s4", "s5", "s0", "s1", "s2", "s3"]);
  });

  it("groups F2L pairs by where they were inserted relative to the solver, not by cube slot", () => {
    const a = analysed("a", "A", 1), b = analysed("b", "A", 2), c = analysed("c", "A", 3);
    // Each solve fills every cube slot, but a and b inserted every pair at front-right.
    for (const item of [a, b]) for (const [order, slot] of ["BL", "FR", "BR", "FL"].entries()) Object.assign(item.analysis!.steps[order + 1], { slot, insertedAt: "FR", insertedAtSource: "inferred" });
    b.analysis!.steps[2].timeMs = 1500;
    for (const [order, insertedAt] of ["FR", "FL", "BR", "BL"].entries()) Object.assign(c.analysis!.steps[order + 1], { insertedAt, insertedAtSource: "grip" });
    skipStep(c, 1);
    c.analysis!.steps[3].insertedAt = null;
    const model = modelFor([a, b, c]);
    expect(model.f2lSlots.map((row) => row.label)).toEqual(["FR", "FL", "BR", "BL"]);
    expect(model.f2lSlots[0]).toMatchObject({ count: 8 });
    expect(model.f2lSlots[0].solveIds.filter((id) => id === "a")).toHaveLength(4);
    expect(model.f2lSlots.slice(1).map((row) => row.count)).toEqual([1, 0, 1]);
    expect(model.f2lUnassignedCount).toBe(1);
    expect(model.f2lInferredCount).toBe(8);
    expect(model.f2lPositions[0]).toMatchObject({ label: "1st pair", count: 2, skipCount: 1 });
  });

  it("leaves pairs from analyses without an insertion position unassigned", () => {
    const item = analysed("old", "A", 1);
    for (const [index, slot] of ["FR", "FL", "BR", "BL"].entries()) item.analysis!.steps[index + 1].slot = slot;
    const model = modelFor([item]);
    expect(model.f2lUnassignedCount).toBe(4);
    expect(model.f2lSlots.every((row) => row.count === 0)).toBe(true);
    expect(model.f2lPositions.every((row) => row.count === 1)).toBe(true);
  });

  it("does not count an insertion position outside the held middle layer", () => {
    const item = analysed("non-f2l-slot", "A", 1);
    for (const step of item.analysis!.steps.slice(1, 5)) step.insertedAt = "UR";
    expect(modelFor([item]).f2lUnassignedCount).toBe(4);
  });

  it("never sums an XCross-reduced F2L into Best Splits", () => {
    const normal = analysed("normal", "A", 1), xcross = analysed("xcross", "A", 2);
    skipStep(xcross, 1);
    const model = modelFor([normal, xcross]);
    expect(model.records.f2l[0].id).toBe("xcross");
    expect(model.bestSplits.sources[1].record?.id).toBe("normal");
    expect(model.bestSplits.totalMs).toBe(5500);
    const only = modelFor([xcross]);
    expect(only.bestSplits.sources[1].record).toBeUndefined();
    expect(only.bestSplits.totalMs).toBeUndefined();
  });

  it("ranks effective Singles deterministically and reverses values without reversing ties", () => {
    const model = modelFor([
      solve("z", "A", 9_000, { createdAt: 1, penalty: "+2" }),
      solve("a", "B", 11_000, { createdAt: 1 }), solve("later", "A", 11_000, { createdAt: 2 }),
      solve("fast", "B", 10_000, { createdAt: 3 }), solve("dnf", "A", 1, { penalty: "DNF" }),
      solve("practice", "A", 1, { practice: true }), solve("replay", "A", 1, { replay: true }), solve("slow", "A", 1, { slowSolve: true }),
    ]);
    expect(model.records.single.map((row) => row.id)).toEqual(["fast", "a", "z", "later"]);
    expect(sortRankingRows(model.records.single, "desc").map((row) => row.id)).toEqual(["a", "z", "later", "fast"]);
    expect(model.records.single.find((row) => row.id === "z")?.value).toBe(11_000);
    expect(model.records.tps).toEqual([]);
  });

  it.each([5, 12, 50, 100] as const)("retains real rolling Ao%i membership across interleaved Sessions", (size) => {
    const solves = Array.from({ length: 220 }, (_, index) => solve(`s${index}`, index % 2 ? "A" : "B", 30_000 - index * 100, { createdAt: index }));
    const model = modelFor([...solves].reverse());
    const metric = `ao${size}` as const;
    expect(model.records[metric]).toHaveLength(2 * (111 - size));
    for (const row of model.records[metric]) {
      if (row.kind !== "average") throw new Error("Average expected");
      const end = solves.findIndex((solve) => solve.id === row.endSolveId) + 1;
      const source = solves.slice(0, end).filter((solve) => solve.sessionId === row.sessionId);
      expect(row.solveIds).toEqual(source.slice(-size).map((solve) => solve.id));
      expect(row.value).toBe(averageOf(source, size));
      expect(row.window.entries.filter((entry) => entry.trim !== "kept")).toHaveLength(2);
      expect(model.solveRows.find((item) => item.solve.id === row.endSolveId)?.averages[metric]).toBe(row.window);
      expect(model.averageProgression.find((point) => point.solveId === row.endSolveId)?.[metric]).toBe(row.value);
      expect(model.averageProgression.find((point) => point.solveId === row.endSolveId)?.sessionId).toBe(row.sessionId);
    }
    expect(model.averageProgression[0].ao5).toBeDefined();
    expect(model.averageProgression.find((point) => point.index === size * 2 - 1)?.[metric]).toBeDefined();
    expect(modelFor(solves.slice(0, size * 2 - 2)).records[metric]).toEqual([]);
    expect(model.latestAverages[metric]?.solveId).toBe("s219");
    expect(model.latestAverages[metric]?.sessionId).toBe("A");
    for (const row of model.pbHistory[metric]) {
      if (row.kind !== "average") throw new Error("Average expected");
      expect(new Set(row.solveIds.map((id) => solves.find((solve) => solve.id === id)!.sessionId)).size).toBe(1);
    }
  });

  it("never treats projected long averages or DNF windows as records", () => {
    const solves = Array.from({ length: 12 }, (_, index) => solve(`s${index}`, "A", 10_000, { createdAt: index }));
    const model = modelFor(solves);
    expect(model.stats.ao50.status).toBe("unavailable");
    const selected = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: "A" }, null);
    expect(selected.stats.ao50.status).toBe("projected");
    expect(model.records.ao50).toEqual([]);
    expect(model.averageProgression.every((point) => point.ao50 === undefined)).toBe(true);
    solves[10].penalty = "DNF";
    expect(modelFor(solves).records.ao5.at(-1)?.value).toBe(10_000);
    solves[11].penalty = "DNF";
    const dnf = modelFor(solves);
    expect(dnf.averageProgression.at(-1)?.ao5).toBeNull();
    expect(dnf.records.ao5.some((row) => row.kind === "average" && row.endSolveId === "s11")).toBe(false);
  });

  it("never uses combined history for achieved or projected long averages", () => {
    const solves = Array.from({ length: 60 }, (_, index) => solve(`s${index}`, index % 2 ? "A" : "B", 10000, { createdAt: index }));
    const model = modelFor(solves);
    expect(model.stats.count).toBe(60);
    expect(model.stats.ao50).toMatchObject({ status: "unavailable", value: undefined });
    expect(model.stats.ao100).toMatchObject({ status: "unavailable", value: undefined });
    expect(model.records.ao50).toEqual([]); expect(model.latestAverages.ao50).toBeUndefined();
    expect(deriveStatistics({ sessions: [session("A"), session("B")], solves }, { event: "333", sessionId: "A" }, null).stats.ao50.status).toBe("projected");
  });

  it("uses the latest completed average even when the newest solve has no window", () => {
    const solves = [
      ...Array.from({ length: 5 }, (_, index) => solve(`a${index}`, "A", 10000 + index * 1000, { createdAt: index })),
      ...Array.from({ length: 4 }, (_, index) => solve(`b${index}`, "B", 1000, { createdAt: index + 10 })),
    ];
    const model = modelFor(solves);
    expect(model.trend.at(-1)?.ao5).toBeUndefined();
    expect(model.latestAverages.ao5).toMatchObject({ solveId: "a4", sessionId: "A", window: { value: 12000 } });
    expect(model.stats.ao5).toBe(12000);
  });

  it.each([5, 12, 50, 100] as const)("preserves selected Session current Ao%i and exact source windows", (size) => {
    const solves = Array.from({ length: 110 }, (_, index) => solve(`a${index}`, "A", 10000 + index * 100, { createdAt: index }));
    const model = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: "A" }, null);
    const metric = `ao${size}` as const;
    const expected = averageOf(solves, size);
    expect(size === 50 || size === 100 ? model.stats[`ao${size}`].value : size === 5 ? model.stats.ao5 : model.stats.ao12).toBe(expected);
    expect(model.latestAverages[metric]?.window).toBe(model.solveRows.at(-1)?.averages[metric]);
  });

  it("scopes all records, cases, PBs, and sources by Event and Session", () => {
    const a = analysed("a", "A", 1), b = analysed("b", "B", 2), other = analysed("c", "C", 3);
    const snapshot = { sessions: [session("A"), session("B"), session("C", "222")], solves: [other, b, a] };
    const all = deriveStatistics(snapshot, { event: "333", sessionId: null }, "C");
    expect(all.records.single.map((row) => row.id)).toEqual(["a", "b"]);
    expect(all.ollCases[0].solveIds).toEqual(["a", "b"]);
    const scoped = deriveStatistics(snapshot, { event: "333", sessionId: "B" }, "A");
    expect(scoped.records.single.map((row) => row.id)).toEqual(["b"]);
    expect(scoped.ollCases[0].solveIds).toEqual(["b"]);
    expect(scoped.pbHistory.single.map((row) => row.id)).toEqual(["b"]);
    expect(scoped.bestSplits.sources.every((source) => source.record?.id === "b")).toBe(true);
  });

  it.each([0, 1, 2] as const)("detects %i consecutive pairs already solved at Cross", (count) => {
    const item = analysed(`xcross${count}`, "A", 1);
    for (let pair = 1; pair <= count; pair++) skipStep(item, pair);
    const model = modelFor([item]);
    expect(model.records.xcross).toHaveLength(count ? 1 : 0);
    if (count) expect(model.records.xcross[0].context).toBe(`${count} pair${count > 1 ? "s" : ""} at Cross`);
  });

  it("does not count later simultaneous pair skips or skipped Cross as XCross records", () => {
    const later = analysed("later", "A", 1); skipStep(later, 3);
    const skippedCross = analysed("skipped-cross", "A", 2); skipStep(skippedCross, 0); skipStep(skippedCross, 1);
    const model = modelFor([later, skippedCross]);
    expect(model.records.xcross).toEqual([]);
    expect(model.records.cross.map((row) => row.id)).toEqual(["later"]);
    expect(model.records["cross-moves"].map((row) => row.id)).toEqual(["later"]);
  });

  it("uses combined F2L metrics and keeps legitimate LL skip context", () => {
    const normal = analysed("normal", "A", 1);
    const skipped = analysed("skip", "A", 2); skipStep(skipped, 5);
    const model = modelFor([normal, skipped]);
    expect(model.records.f2l[0]).toMatchObject({ value: 2_500, moves: 8 });
    expect(model.records.f2l[0].tps).toBeCloseTo(8 / 1.7);
    expect(model.records["f2l-moves"][0].value).toBe(8);
    expect(model.records["f2l-tps"][0].value).toBeCloseTo(8 / 1.7);
    expect(model.records.oll.map((row) => row.id)).toEqual(["normal"]);
    expect(model.records["oll-tps"].map((row) => row.id)).toEqual(["normal"]);
    expect(model.records["last-layer"][0]).toMatchObject({ id: "skip", value: 1000, context: "OLL skip" });
    expect(model.records.execution[0].value).toBe(8_000);
  });

  it("uses execution time for phase TPS and solving time for whole-solve TPS", () => {
    const slow = analysed("slow", "A", 1), fast = analysed("fast", "A", 2);
    fast.analysis!.sliceTurns = 60;
    fast.analysis!.steps[5].executionMs = 400;
    const model = modelFor([slow, fast]);
    expect(model.records.tps.map((row) => row.value)).toEqual([6, 5]);
    expect(model.records["oll-tps"].map((row) => row.value)).toEqual([5, 2.5]);
  });

  it("excludes malformed analysis without excluding the Single", () => {
    const missing = solve("keyboard", "A", 1000);
    const invalid = analysed("invalid", "A", 2); invalid.analysis!.steps[3].executionMs = NaN;
    const boundary = analysed("boundary", "A", 3); boundary.analysis!.steps[1].fromMove = 100;
    const model = modelFor([missing, invalid, boundary]);
    expect(model.records.single).toHaveLength(3);
    expect(model.records.moves).toEqual([]);
    expect(model.records.cross).toEqual([]);
    expect(model.pauses).toBeUndefined();
  });

  it("summarises pair performance without zero-time skipped pairs distorting medians", () => {
    const a = analysed("a", "A", 1), b = analysed("b", "A", 2), c = analysed("c", "A", 3);
    b.analysis!.steps[1] = { ...b.analysis!.steps[1], timeMs: 1500, recognitionMs: 500, executionMs: 1000, sliceTurns: 8 };
    skipStep(c, 1);
    const first = modelFor([a, b, c]).f2lPositions[0];
    expect(first).toMatchObject({ label: "1st pair", count: 2, skipCount: 1, bestMs: 500, medianMs: 1000, recognitionMs: 350, executionMs: 650, moves: 5 });
    expect(first.tps).toBeCloseTo(10 / 1.3);
    expect(first.solveIds).toEqual(["a", "b"]);
    expect(first.samples).toHaveLength(2);
    expect(first.samples[0]).toMatchObject({ solveId: "a", timeMs: 500, recognitionMs: 200, executionMs: 300, moves: 2 });
    expect(first.samples[0].tps).toBeCloseTo(2 / 0.3);
    expect(first.samples[1]).toMatchObject({ solveId: "b", timeMs: 1500, recognitionMs: 500, executionMs: 1000, moves: 8, tps: 8 });
  });

  it("counts a zero-range XCross pair separately even without the skipped marker", () => {
    const normal = analysed("normal", "A", 1), xcross = analysed("xcross", "A", 2);
    skipStep(xcross, 1);
    xcross.analysis!.steps[1].skipped = false;
    const model = modelFor([normal, xcross]);
    expect(model.records.xcross[0].context).toBe("1 pair at Cross");
    expect(model.f2lPositions[0]).toMatchObject({ count: 1, skipCount: 1, bestMs: 500, medianMs: 500, moves: 2, solveIds: ["normal"] });
    expect(model.records.f2l.find((row) => row.id === "xcross")?.value).toBe(2000);
  });

  it("groups OLL/PLL cases, separates skips, and sorts stably", () => {
    const a = analysed("a", "A", 1), b = analysed("b", "B", 2), c = analysed("c", "A", 3), d = analysed("d", "A", 4);
    b.analysis!.steps[5] = { ...b.analysis!.steps[5], timeMs: 2000, recognitionMs: 400, executionMs: 1600, sliceTurns: 6 };
    c.analysis!.steps[5].case = "2"; c.analysis!.steps[6].case = "Ua";
    skipStep(d, 5); skipStep(d, 6);
    const model = modelFor([a, b, c, d]);
    expect(model.ollCases.map((row) => row.caseId)).toEqual(["2", "27"]);
    expect(model.ollCases[1]).toMatchObject({ count: 2, bestMs: 1000, medianMs: 1500, recognitionMs: 300, executionMs: 1200, moves: 4, solveIds: ["a", "b"] });
    expect(model.ollCases[1].tps).toBeCloseTo(8 / 2.4);
    expect(model.ollSkips).toBe(1); expect(model.pllSkips).toBe(1);
    expect(model.pllCases.map((row) => row.caseId)).toEqual(["T", "Ua"]);
    expect(sortCasePerformance(model.ollCases, "median", "desc").map((row) => row.caseId)).toEqual(["27", "2"]);
    expect(sortCasePerformance(model.ollCases, "count", "desc")[0].caseId).toBe("27");
  });

  it("attributes pauses to the phase of the next move, including boundaries", () => {
    const item = analysed("pausing", "A", 1);
    item.analysis!.pauses = [
      { afterMove: 0, startMs: 100, durationMs: 250 }, // next raw index 1, Cross
      { afterMove: 1, startMs: 200, durationMs: 500 }, // index 2, first F2L
      { afterMove: 9, startMs: 300, durationMs: 750 }, // index 10, OLL
      { afterMove: 11, startMs: 400, durationMs: 1000 }, // index 12, PLL
    ];
    const model = modelFor([item, analysed("free", "A", 2)]);
    expect(model.pauses).toMatchObject({ sampleSize: 2, pauseCount: 4, meanCount: 2, meanDurationMs: 625, meanTotalMs: 1250, pauseFreeCount: 1, pauseFreeShare: 0.5, longest: { solveId: "pausing", durationMs: 1000 } });
    expect(model.pauses!.phases.map((phase) => phase.totalMs)).toEqual([250, 500, 750, 1000]);
    expect(model.pauses!.phases.map((phase) => phase.share)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("uses rolling medians of at most ten analysed solves for recognition/execution", () => {
    const solves = Array.from({ length: 12 }, (_, index) => {
      const item = analysed(`s${index}`, "A", index);
      item.analysis!.totalRecognitionMs = index * 100;
      item.analysis!.totalExecutionMs = 10_000 - index * 100;
      return item;
    });
    const model = modelFor(solves);
    expect(model.recognitionTrend.at(-1)).toMatchObject({ solveId: "s11", recognitionMs: 650, executionMs: 9350 });
    expect(model.recognitionExecution).toMatchObject({ medianRecognitionMs: 550, medianExecutionMs: 9450, medianF2lRecognitionMs: 800, medianOllRecognitionMs: 200, medianPllRecognitionMs: 200, medianRecognitionShare: 0.055 });
  });

  it("accounts for measured execution and opening time without conflating them", () => {
    const item = analysed("opening", "A", 1);
    item.analysis!.totalExecutionMs = 7500;
    const model = modelFor([item]);
    expect(model.recognitionExecution).toMatchObject({ solvingMs: 10000, recognitionMs: 2000, executionMs: 7500, unclassifiedMs: 500, executionShare: 0.75, unclassifiedShare: 0.05, medianExecutionMs: 7500, medianExecutionShare: 0.75 });
    const split = model.recognitionExecution!;
    expect(split.recognitionMs + split.executionMs + split.unclassifiedMs).toBe(split.solvingMs);
    expect(model.records.execution[0].value).toBe(7500);
    expect(model.recognitionTrend[0].executionMs).toBe(7500);
    expect(model.recognitionTrend[0].unclassifiedMs).toBe(500);
  });

  it("records strict Single and average PBs with exact source windows", () => {
    const solves = [20, 20, 19, 19, 18, 18, 17, 16, 15].map((ms, index) => solve(`s${index}`, "A", ms * 1000, { createdAt: index }));
    const model = modelFor(solves);
    expect(model.pbHistory.single.map((row) => row.id)).toEqual(["s0", "s2", "s4", "s6", "s7", "s8"]);
    const rows = model.pbHistory.ao5;
    expect(rows.every((row, index) => !index || row.value < rows[index - 1].value)).toBe(true);
    const last = rows.at(-1)!;
    if (last.kind !== "average") throw new Error("Average expected");
    expect(last.solveIds).toEqual(["s4", "s5", "s6", "s7", "s8"]);
    expect(last.createdAt).toBe(8);
  });

  it("selects non-skipped Best split sources and reports unavailable composites", () => {
    const a = analysed("a", "A", 1), b = analysed("b", "A", 2);
    b.analysis!.steps[0].timeMs = 500;
    b.analysis!.steps[1].timeMs = 100;
    skipStep(b, 5); skipStep(b, 6);
    const model = modelFor([a, b]);
    expect(model.bestSplits.sources.map((source) => source.record?.id)).toEqual(["b", "b", "a", "a"]);
    expect(model.bestSplits.totalMs).toBe(4600);
    expect(model.bestSplits.gapMs).toBe(5400);
    expect(modelFor([b]).bestSplits.totalMs).toBeUndefined();
  });

  it("adds real consistency percentiles and PB/median gaps", () => {
    const model = modelFor([10, 20, 30, 40, 50].map((ms, index) => solve(`s${index}`, "A", ms * 1000)));
    expect(model.consistency).toMatchObject({ pbMs: 10_000, medianMs: 30_000, gapMs: 20_000, gapShare: 2 / 3, p10Ms: 14_000, p25Ms: 20_000, p75Ms: 40_000, p90Ms: 46_000 });
    expect(modelFor([]).consistency.gapMs).toBeUndefined();
  });
});

describe("Session-local trends", () => {
  function timed(id: string, sessionId: string, createdAt: number, recognitionMs: number) {
    const item = analysed(id, sessionId, createdAt);
    item.analysis!.totalRecognitionMs = recognitionMs;
    item.analysis!.totalExecutionMs = 10_000 - recognitionMs;
    item.analysis!.steps[0].timeMs = recognitionMs;
    return item;
  }

  it("resets phase and recognition medians at a Session and continues a returning Session's own history", () => {
    const solves = [
      ...[100, 200, 300].map((ms, i) => timed(`a${i}`, "A", i, ms)),
      ...[5000, 6000].map((ms, i) => timed(`b${i}`, "B", 10 + i, ms)),
      timed("a3", "A", 20, 400),
    ];
    const model = modelFor(solves);
    const recognition = new Map(model.recognitionTrend.map((point) => [point.solveId, point]));
    expect(recognition.get("b0")!.recognitionMs).toBe(5000);
    expect(recognition.get("b1")!.recognitionMs).toBe(5500);
    expect(recognition.get("a3")!.recognitionMs).toBe(250);
    expect(model.phaseTrend.find((point) => point.solveId === "b0")!.crossMs).toBe(5000);
    expect(model.phaseTrend.find((point) => point.solveId === "a3")!.crossMs).toBe(250);
    expect(recognition.get("b0")).toMatchObject({ sessionId: "B", createdAt: 10 });
    const keys = model.recognitionTrend.map((point) => point.segmentKey);
    expect(keys).toEqual(["0", "0", "0", "1", "1", "2"]);
    expect(model.phaseTrend.map((point) => point.segmentKey)).toEqual(keys);
  });

  it("changes segment through a Session without analysed solves", () => {
    const model = modelFor([timed("a0", "A", 0, 100), solve("b0", "B", 9_000, { createdAt: 1 }), timed("a1", "A", 2, 300)]);
    expect(model.phaseTrend.map((point) => point.segmentKey)).toEqual(["0", "2"]);
  });

  it("derives segment keys and Session-local windows", () => {
    const items = ["A", "A", "B", "A"].map((sessionId, index) => ({ id: `s${index}`, sessionId }));
    expect([...sessionSegmentKeys(items).values()]).toEqual(["0", "0", "1", "2"]);
    expect(sessionLocalWindows(items, 2).map((window) => window.map((item) => item.id))).toEqual([["s0"], ["s0", "s1"], ["s2"], ["s1", "s3"]]);
  });
});

describe("Statistics insights", () => {
  it("compares recent counted form with the previous window, counting DNFs separately", () => {
    expect(recentForm(Array.from({ length: 9 }, (_, i) => solve(`s${i}`, "A", 10_000)))).toBeNull();
    const solves = Array.from({ length: 24 }, (_, i) => solve(`s${i}`, "A", i < 12 ? 12_000 + (i % 4) * 100 : 11_000 + (i % 4) * 300, { createdAt: i }));
    solves[23] = { ...solves[23], penalty: "DNF" };
    const form = recentForm(solves)!;
    expect(form).toMatchObject({ sampleSize: 12, baselineMedianMs: 12_150, recentDnfCount: 1, baselineDnfCount: 0 });
    expect(form.medianDeltaMs).toBe(form.recentMedianMs - 12_150);
    expect(form.medianDeltaMs).toBeLessThan(0);
    expect(form.iqrDeltaMs).toBeGreaterThan(0);
    expect(recentForm(solves.slice(0, 10))?.sampleSize).toBe(5);
  });

  it("is unavailable when either window has fewer than three finished results", () => {
    const solves = Array.from({ length: 10 }, (_, i) => solve(`s${i}`, "A", 10_000, { createdAt: i, penalty: i >= 7 ? "DNF" : "none" }));
    expect(recentForm(solves)).toBeNull();
  });

  it("describes current single-Session averages against their best", () => {
    const solves = [10, 10, 10, 10, 10, 12, 12, 12, 12, 12].map((s, i) => solve(`s${i}`, "A", s * 1000, { createdAt: i }));
    const model = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: "A" }, "A");
    expect(model.averageStandings.ao5).toMatchObject({ value: 12_000, bestMs: 10_000, deltaToBestMs: 2_000, isBest: false, status: "actual" });
    expect(model.averageStandings.ao12).toMatchObject({ value: undefined, status: "unavailable", isBest: false });
    expect(model.averageStandings.ao50).toMatchObject({ status: "projected", count: 10 });
    expect(modelFor(solves.slice(0, 5)).averageStandings.ao5).toMatchObject({ isBest: true, sourceSessionId: "A" });
  });

  it("suggests the slowest sufficiently sampled cases", () => {
    const row = (caseId: string, count: number, medianMs: number, recognitionMs = 0) =>
      ({ caseId, label: caseId, count, skipCount: 0, solveIds: [], samples: [], medianMs, recognitionMs });
    const rows = [row("1", 5, 1000), row("2", 2, 9000), row("3", 3, 2000, 100), row("4", 4, 2000, 300), row("5", 9, 1500)];
    expect(focusCases(rows).map((item) => item.caseId)).toEqual(["4", "3", "5"]);
    expect(focusCases(rows, { minSamples: 1, limit: 1 })[0].caseId).toBe("2");
  });

  it("slices every chart series to the same counted window", () => {
    const solves = Array.from({ length: 60 }, (_, i) => analysed(`s${i}`, "A", i));
    const model = modelFor(solves);
    const series = chartWindowSeries(model, 50);
    expect(series.trend).toHaveLength(50);
    expect(series.phases.map((point) => point.solveId)).toEqual(series.trend.map((point) => point.id));
    expect(series.recognition).toHaveLength(50);
    expect(series.averages[0].solveId).toBe("s10");
    expect(chartWindowSeries(model, "all").trend).toHaveLength(60);
  });
});

describe("performance table sorting", () => {
  const row = (label: string, values: { bestMs?: number; moves?: number; skipCount?: number; tps?: number }) =>
    ({ label, count: 1, skipCount: values.skipCount ?? 0, solveIds: [], samples: [], ...values });
  const rows = [row("10", { bestMs: 900, moves: 9, skipCount: 2 }), row("2", { bestMs: 1200, moves: 7, tps: 5 }), row("1", { moves: 7, skipCount: 1, tps: 3 })];

  it("sorts labels naturally and every metric column with missing values last", () => {
    expect(sortPerformanceRows(rows, "case", "asc").map((item) => item.label)).toEqual(["1", "2", "10"]);
    expect(sortPerformanceRows(rows, "case", "desc").map((item) => item.label)).toEqual(["10", "2", "1"]);
    expect(sortPerformanceRows(rows, "best", "asc").map((item) => item.label)).toEqual(["10", "2", "1"]);
    expect(sortPerformanceRows(rows, "best", "desc").map((item) => item.label)).toEqual(["2", "10", "1"]);
    expect(sortPerformanceRows(rows, "moves", "asc").map((item) => item.label)).toEqual(["1", "2", "10"]);
    expect(sortPerformanceRows(rows, "skips", "desc").map((item) => item.label)).toEqual(["10", "1", "2"]);
    expect(sortPerformanceRows(rows, "tps", "desc").map((item) => item.label)).toEqual(["2", "1", "10"]);
  });
});
