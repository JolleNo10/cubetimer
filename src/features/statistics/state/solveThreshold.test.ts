import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, effectiveMs, type Solve } from "../../../app/types";
import { applySolveThreshold } from "./solveThreshold";
import { countedSolves, formatSolveTime, sessionStats } from "./stats";
import { deriveStatistics } from "./statistics";

const solve = (index: number, rawMs = 10000, sessionId = "A", changes: Partial<Solve> = {}): Solve => ({
  id: `s${index}`, createdAt: index, sessionId, rawMs, penalty: "none", source: "keyboard", moves: [], scramble: "R U", ...changes,
});
const baseline = () => Array.from({ length: 5 }, (_, index) => solve(index));
const options = { slowSolveThreshold: 3, slowSolveHandling: "exclude" } as const;

describe("unusually slow solve threshold", () => {
  it("uses a median with five baseline times, flags strictly above the threshold and keeps history", () => {
    const raw = [...baseline(), solve(5, 30000), solve(6, 40000), solve(7)];
    const result = applySolveThreshold(raw, options);
    expect(result[5].statisticsOutlier).toBeUndefined();
    expect(result[6].statisticsOutlier).toEqual({ action: "exclude", baselineMs: 10000, multiplier: 3 });
    expect(result[6].rawMs).toBe(40000); expect(result[6].penalty).toBe("none");
    expect(result).toHaveLength(raw.length); expect(raw.every(s => !s.statisticsOutlier)).toBe(true);
    expect(countedSolves(result)).toHaveLength(7);
    expect(sessionStats(result).worst).toBe(30000);
  });
  it("does not flag before five successful baseline solves", () => {
    expect(applySolveThreshold([solve(0), solve(1), solve(2), solve(3), solve(4, 40000)], options)[4].statisticsOutlier).toBeUndefined();
  });
  it("never lets excluded times, deliberate slow/replay, DNF or invalid durations contaminate a baseline", () => {
    const raw = [...baseline(), solve(5, 90000, "A", { slowSolve: true }), solve(6, 90000, "A", { practice: true }),
      solve(7, 90000, "A", { replay: true }), solve(8, 90000, "A", { penalty: "DNF" }), solve(9, NaN), solve(10, 0),
      ...Array.from({ length: 25 }, (_, i) => solve(i + 11, 40000)), solve(36, 40000)];
    const result = applySolveThreshold(raw, options);
    expect(result[4].statisticsOutlier).toBeUndefined();
    expect(result.at(-1)?.statisticsOutlier?.baselineMs).toBe(10000);
    expect(result.slice(11).every(s => s.statisticsOutlier?.baselineMs === 10000)).toBe(true);
  });
  it("uses only the latest 20 successful times and never another Session's history", () => {
    const raw = [...baseline(), ...Array.from({ length: 20 }, (_, i) => solve(i + 5, 20000)), solve(25, 50000), solve(26, 40000, "B")];
    const result = applySolveThreshold(raw, options);
    expect(result[25].statisticsOutlier).toBeUndefined();
    expect(result[26].statisticsOutlier).toBeUndefined();
    const later = applySolveThreshold([...raw, solve(27, 70000)], options);
    expect(later[27].statisticsOutlier?.baselineMs).toBe(20000);
  });
  it("orders a mixed/reversed history before evaluating, without changing input ordering", () => {
    const raw = [...baseline(), solve(5, 40000), ...baseline().map(s => ({ ...s, id: `b${s.id}`, sessionId: "B", rawMs: 50000 }))].reverse();
    const result = applySolveThreshold(raw, options);
    expect(result.map(s => s.id)).toEqual(raw.map(s => s.id));
    expect(result.find(s => s.id === "s5")?.statisticsOutlier?.baselineMs).toBe(10000);
  });
  it("can reconsider existing and already projected history when disabled or raised", () => {
    const raw = [...baseline(), solve(5, 40000)];
    const flagged = applySolveThreshold(raw, options);
    expect(applySolveThreshold(flagged, { ...options, slowSolveHandling: "off" })).toEqual(raw);
    expect(applySolveThreshold(flagged, { ...options, slowSolveThreshold: 5 })).toEqual(raw);
  });
  it("counts flagged solves as DNF using ordinary average and dashboard semantics", () => {
    const raw = [...baseline(), solve(5, 40000), solve(6, 50000)];
    const result = applySolveThreshold(raw, { ...options, slowSolveHandling: "dnf" });
    expect(countedSolves(result)).toHaveLength(7); expect(effectiveMs(result[5])).toBeNull();
    expect(formatSolveTime(result[5])).toBe("DNF(40.00)"); expect(result[5].penalty).toBe("none");
    expect(result[6].statisticsOutlier?.baselineMs).toBe(10000);
    expect(sessionStats(result).ao5).toBeNull();
    const sessions = [{ id: "A", event: "333" as const, name: "A", createdAt: 0 }];
    const model = deriveStatistics({ sessions, solves: result }, { event: "333", sessionId: "A" }, "A");
    expect(model.stats.count).toBe(7); expect(model.stats.solved).toBe(5); expect(model.dnfRate).toBeCloseTo(2 / 7);
    const excluded = deriveStatistics({ sessions, solves: applySolveThreshold(raw, DEFAULT_SETTINGS) }, { event: "333", sessionId: "A" }, "A");
    expect(excluded.stats.count).toBe(5); expect(excluded.stats.mean).toBe(10000); expect(excluded.scopeSolves).toHaveLength(7);
  });
  it("uses effective times including +2 while preserving genuine DNF penalties", () => {
    const raw = [...baseline().map(s => ({ ...s, penalty: "+2" as const })), solve(5, 35000, "A", { penalty: "+2" }), solve(6, 40000, "A", { penalty: "DNF" })];
    const result = applySolveThreshold(raw, options);
    expect(result[5].statisticsOutlier?.baselineMs).toBe(12000);
    expect(result[6].statisticsOutlier).toBeUndefined(); expect(effectiveMs(result[6])).toBeNull();
  });
});
