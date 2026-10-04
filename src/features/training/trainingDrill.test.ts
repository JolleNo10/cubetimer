import { describe, expect, it } from "vitest";
import { drillCatalogue, drillCaseId, drillCaseWeight, selectDrillCase, trainingDrillSummary, weakDrillCases, type TrainingDrillRoundOutcome } from "./trainingDrill";
import { EMPTY_TRAINING_CASE_STATS, type TrainingCaseStats } from "./trainingPerformance";
import type { TrainingAttempt } from "../../app/types";

const cases = drillCatalogue({ family: "f2l", library: "basic", position: "FR" }).slice(0, 3);
const stats = (values: Partial<TrainingCaseStats> = {}): TrainingCaseStats => ({ ...EMPTY_TRAINING_CASE_STATS, ...values });
describe("Drill selection policy", () => {
  it("cycles selected catalogue order, independently of click order, including one case", () => {
    const selected = ["F2L 3", "F2L 1"];
    const pool = cases.filter(c => selected.includes(drillCaseId(c)));
    expect([0, 1, 2, 3, 4].map(round => drillCaseId(selectDrillCase(pool, "sequence", round, null, [])!)))
      .toEqual(["F2L 1", "F2L 3", "F2L 1", "F2L 3", "F2L 1"]);
    expect(selectDrillCase([cases[0]], "sequence", 12, "F2L 1", [])).toEqual(cases[0]);
    expect(selectDrillCase([], "sequence", 0, null, [])).toBeNull();
  });
  it("draws uniformly with deterministic boundaries and avoids previous when possible", () => {
    for (const [rng, expected] of [[0, 0], [0.333, 0], [1 / 3, 1], [0.999, 2], [1, 2]]) {
      expect(selectDrillCase(cases, "random", 0, null, [], () => rng)).toEqual(cases[expected]);
    }
    expect(selectDrillCase(cases, "random", 1, "F2L 1", [], () => 0)).toEqual(cases[1]);
    expect(selectDrillCase([cases[0]], "random", 1, "F2L 1", [], () => 0)).toEqual(cases[0]);
  });
  it("uses explicit New/Learning/Review/Practised baseline weights", () => {
    expect(["practiced", "learning", "new", "review"].map(status => drillCaseWeight(stats({ status: status as TrainingCaseStats["status"] }))))
      .toEqual([1, 3, 4, 6]);
  });
  it("caps STM and timing weakness and prefers complete case-time ratios", () => {
    const base = stats({ status: "practiced", recentMedianDelta: 2 });
    expect(drillCaseWeight(base)).toBe(3);
    expect(drillCaseWeight({ ...base, recentMedianDelta: 100 })).toBe(5);
    expect(drillCaseWeight({ ...base, bestCaseTimeMs: 1000, recentMedianCaseTimeMs: 1400 })).toBeCloseTo(5);
    expect(drillCaseWeight({ ...base, bestMoveSpanMs: 100, recentMedianMoveSpanMs: 10000 })).toBe(7);
    expect(drillCaseWeight({ ...base, bestCaseTimeMs: 1000, recentMedianCaseTimeMs: 1000, bestMoveSpanMs: 100, recentMedianMoveSpanMs: 10000 })).toBe(3);
    expect(drillCaseWeight(stats({ status: "practiced" }))).toBe(1);
  });
  it("walks cumulative weights only within the selected pool and removes the previous case for one draw", () => {
    const history: TrainingAttempt[] = Array.from({ length: 3 }, (_, i) => ({
      id: String(i), createdAt: i, mode: "virtual", activity: "drill", caseTimeMs: 1000,
      target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 1", position: "FR" },
      moves: ["R"], stm: 1, elapsedMs: 0, recommendedStm: 1, matchedReferenceRank: 1, delta: 0,
    }));
    // Practised A = 1, unseen C = 4. B is never introduced.
    const pool = [cases[0], cases[2]];
    expect(selectDrillCase(pool, "weighted", 0, null, history, () => 0.19)).toEqual(cases[0]);
    expect(selectDrillCase(pool, "weighted", 0, null, history, () => 0.2)).toEqual(cases[2]);
    expect(selectDrillCase(pool, "weighted", 1, "F2L 3", history, () => 0.99)).toEqual(cases[0]);
    expect(selectDrillCase([cases[0]], "weighted", 1, "F2L 1", history, () => 0)).toEqual(cases[0]);
  });
  it("keeps F2L library/position and last-layer set identities in the candidate catalogue", () => {
    expect(drillCatalogue({ family: "f2l", library: "advanced", position: "FL" })[0]).toMatchObject({ library: "advanced", position: "FL" });
    expect(drillCatalogue({ family: "oll", trainingSet: "2look" })).toHaveLength(10);
    expect(drillCatalogue({ family: "pll", trainingSet: "2look" })).toHaveLength(6);
  });
});


const skipped = (caseId = "F2L 1"): TrainingDrillRoundOutcome => ({ caseId, outcome: "skipped", completedAt: 1 });
const solved = (caseId: string, caseTimeMs: number, delta: number | null = 0, stm = 8): TrainingDrillRoundOutcome =>
  ({ caseId, outcome: "solved", completedAt: 2, caseTimeMs, moveSpanMs: 100, delta, stm });
describe("current Drill run feedback", () => {
  it("adds a strong capped skip signal without changing historical stats", () => {
    const practiced = stats({ status: "practiced" });
    expect(drillCaseWeight(practiced, [skipped()])).toBe(7);
    expect(drillCaseWeight(practiced, [skipped(), skipped()])).toBe(13);
    expect(drillCaseWeight(practiced, Array.from({ length: 20 }, () => skipped()))).toBe(13);
    expect(practiced.status).toBe("practiced");
    expect(drillCaseWeight(practiced, [skipped(), ...Array.from({ length: 5 }, () => solved("F2L 1", 1000))])).toBe(1);
  });
  it("composes current solved weakness and historical weakness using the same caps", () => {
    const practiced = stats({ status: "practiced", bestCaseTimeMs: 1000 });
    expect(drillCaseWeight(practiced, [solved("F2L 1", 1400, 2)])).toBeCloseTo(5);
    expect(drillCaseWeight(stats({ status: "review", recentMedianDelta: 3 }), [solved("F2L 1", 1000, 1)])).toBe(9);
    expect(drillCaseWeight(practiced, [solved("F2L 1", 0, null)])).toBe(1);
  });
  it("keeps pool boundaries and immediate-repeat exclusion despite skip boosts", () => {
    const outcomes = [skipped(), skipped(), skipped("F2L 2")];
    const pool = [cases[0], cases[2]];
    // A = unseen 4 + skips 12, C = unseen 4.
    expect(selectDrillCase(pool, "weighted", 0, null, [], () => 0.79, outcomes)).toBe(cases[0]);
    expect(selectDrillCase(pool, "weighted", 0, null, [], () => 0.8, outcomes)).toBe(cases[2]);
    expect(selectDrillCase(pool, "weighted", 0, "F2L 1", [], () => 0, outcomes)).toBe(cases[2]);
    expect(selectDrillCase(pool, "weighted", 0, null, [], () => 0.8, [skipped("F2L 2")])).toBe(cases[2]);
  });
  it("summarizes completed rounds using solved metrics only", () => {
    expect(trainingDrillSummary([solved("F2L 1", 1000, 0, 6), skipped(), solved("F2L 2", 3000, 0, 10)]))
      .toEqual({ rounds: 3, solved: 2, skipped: 1, averageCaseTimeMs: 2000, bestCaseTimeMs: 1000, averageStm: 8 });
    expect(trainingDrillSummary([skipped()])).toEqual({ rounds: 1, solved: 0, skipped: 1,
      averageCaseTimeMs: null, bestCaseTimeMs: null, averageStm: null });
  });
  it("ranks skips, then timing regression, then STM weakness and catalogue order", () => {
    const pool = drillCatalogue({ family: "f2l", library: "basic", position: "FR" }).slice(0, 5);
    const outcomes = [skipped("F2L 5"), solved("F2L 1", 6000), solved("F2L 2", 1000, 3),
      solved("F2L 3", 1000, 3), solved("F2L 4", 1000)];
    expect(weakDrillCases(pool, outcomes, []).map(c => c.caseId)).toEqual(["F2L 5", "F2L 1", "F2L 2", "F2L 3"]);
    expect(weakDrillCases(pool, outcomes, [], 2).map(c => c.caseId)).toEqual(["F2L 5", "F2L 1"]);
    expect(weakDrillCases(pool, [solved("F2L 1", 1000)], [])).toEqual([]);
    expect(weakDrillCases(pool, [skipped("outside pool")], [])).toEqual([]);
  });
});


it("finds slow first-run cases even after their solved attempts enter persisted history", () => {
  const outcomes = [solved("F2L 1", 6000), solved("F2L 2", 1000), solved("F2L 3", 1000)];
  const history: TrainingAttempt[] = outcomes.map((o, i) => ({
    id: String(i), createdAt: i, mode: "virtual", activity: "drill", caseTimeMs: o.outcome === "solved" ? o.caseTimeMs : null,
    target: { family: "f2l", origin: "catalog", library: "basic", caseName: o.caseId, position: "FR" },
    moves: ["R"], stm: 8, elapsedMs: 100, recommendedStm: 8, matchedReferenceRank: 1, delta: 0,
  }));
  expect(weakDrillCases(cases, outcomes, history).map(c => c.caseId)).toEqual(["F2L 1"]);
});
