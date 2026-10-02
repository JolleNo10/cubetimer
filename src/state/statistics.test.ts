import { describe, expect, it } from "vitest";
import { STEP_NAMES, type SolveAnalysis } from "../cube/analysis";
import { DEFAULT_EVENT_ID } from "../cube/scramble";
import { averageOf } from "./stats";
import {
  deriveStatistics,
  percentile,
  sliceChartWindow,
  type StatisticsSnapshot,
} from "./statistics";
import type { Penalty, Session, Solve } from "./types";

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
      steps: STEP_NAMES.map((name, index) => ({
        name,
        timeMs: index === 1 ? 500 : index === 2 ? 500 : index === 3 ? 500 : 1_000,
      })),
    } as unknown as SolveAnalysis,
  });
}

describe("deriveStatistics", () => {
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
    const result = deriveStatistics(snapshot, { event: "333", sessionId: null });
    expect(result.scopeSolves.map((item) => item.id)).toEqual(["b-1", "a-2"]);
    expect(result.stats.count).toBe(2);
    expect(result.ignoredSolveCount).toBe(1);
  });

  it("supports an individual Session without changing external state", () => {
    const result = deriveStatistics(snapshot, { event: "333", sessionId: "A" });
    expect(result.scopeSolves.map((item) => item.sessionId)).toEqual(["A"]);
    expect(result.sessionComparison).toHaveLength(2);
  });

  it("orders an interleaved trend chronologically and uses WCA rolling averages", () => {
    const solves = [
      solve("a", "A", 10_000, { createdAt: 2 }),
      solve("b", "B", 12_000, { createdAt: 1 }),
      solve("c", "A", 14_000, { createdAt: 3 }),
      solve("d", "B", 16_000, { createdAt: 4 }),
      solve("e", "A", 18_000, { createdAt: 5 }),
    ];
    const result = deriveStatistics({ sessions: [session("A"), session("B")], solves }, { event: "333", sessionId: null });
    expect(result.trend.map((point) => point.id)).toEqual(["b", "a", "c", "d", "e"]);
    expect(result.trend.at(-1)?.ao5).toBe(14_000);
    expect(result.trend.at(-1)?.ao5).toBe(averageOf(solves.sort((a, b) => a.createdAt - b.createdAt), 5));
  });

  it("applies all ordinary-statistics exclusions while retaining DNFs", () => {
    const solves = [
      solve("normal", "A", 10_000),
      solve("dnf", "A", 10_000, { penalty: "DNF" }),
      solve("practice", "A", 1_000, { practice: true }),
      solve("replay", "A", 1_000, { replay: true }),
      solve("slow", "A", 1_000, { slowSolve: true }),
    ];
    const result = deriveStatistics({ sessions: [session("A")], solves }, { event: "333", sessionId: null });
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
    }, { event: "333", sessionId: null });
    expect(result.analysisCount).toBe(2);
    expect(result.recognitionExecution).toMatchObject({
      sampleSize: 2,
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
    }, { event: "333", sessionId: null });
    expect(result.phaseTrend).toHaveLength(2);
    expect(result.sessionComparison.map((row) => row.session.id)).toEqual(["new", "old", "empty"]);
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
