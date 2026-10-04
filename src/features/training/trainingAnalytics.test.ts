import { describe, expect, it } from "vitest";
import type { TrainingAttempt, TrainingRecognitionAttempt } from "../../app/types";
import { trainingAnalytics, trainingInsightsCatalogue, trainingRunProgression, trainingTrends } from "./trainingAnalytics";
import { trainingContextHistory } from "./trainingBrowseContext";
const execution = (index: number, overrides: Partial<TrainingAttempt> = {}): TrainingAttempt => ({ id: `e${index}`, createdAt: index,
  activity: "drill", mode: "virtual", drillRunId: "execution", drillRound: index + 1, caseTimeMs: 1000 + index * 100, elapsedMs: 500 + index * 100,
  target: { family: "oll", origin: "catalog", trainingSet: "full", caseId: "27", auf: index % 4 as 0 | 1 | 2 | 3 },
  moves: ["R"], stm: 10, recommendedStm: 8, matchedReferenceRank: 1, delta: 2,
  preferredStm: null, matchedPreferred: null, preferredDelta: null, ...overrides });
const recognition = (index: number, correct = true): TrainingRecognitionAttempt => ({ id: `r${index}`, createdAt: index,
  drillRunId: "recognition", drillRound: index + 1, target: { family: "oll", trainingSet: "full", caseId: "27" },
  answerCaseId: correct ? "27" : "26", responseMs: 1000 + index * 100 });
describe("Training Insights pure analytics", () => {
  it("ignores all nonpositive/nonfinite durations without erasing attempts", () => {
    const invalid = [0, -1, NaN, Infinity].map((value, i) => execution(i, { elapsedMs: value, caseTimeMs: value }));
    expect(trainingAnalytics(invalid, []).execution).toMatchObject({ attempts: 4, bestMoveSpanMs: null, medianMoveSpanMs: null, bestCaseTimeMs: null, medianCaseTimeMs: null });
    expect(trainingAnalytics([execution(0, { elapsedMs: 0, activity: "single", caseTimeMs: null })], []).execution.medianMoveSpanMs).toBeNull();
    expect(trainingAnalytics([...invalid, execution(5, { elapsedMs: 100, caseTimeMs: 200 }), execution(6, { elapsedMs: 300, caseTimeMs: 400 })], []).execution)
      .toMatchObject({ attempts: 6, medianMoveSpanMs: 200, bestMoveSpanMs: 100, medianCaseTimeMs: 300, bestCaseTimeMs: 200 });
    const progression = trainingRunProgression(Array.from({ length: 6 }, (_, i) => execution(i, { caseTimeMs: i === 0 ? 1000 : 0 })), []);
    expect(progression.executionRuns[0]).toMatchObject({ rounds: 6, firstMs: null, secondMs: null, deltaMs: null });
    expect(progression.medianExecutionDeltaMs).toBeNull();
  });
  it("filters every analytics surface by exact context before windows and aggregation", () => {
    const contexts = trainingInsightsCatalogue();
    const rows = contexts.map((target, i) => execution(i, { target: target.family === "f2l" ? { ...target, origin: "catalog" } : { ...target, origin: "catalog", auf: 0 } }));
    const answers = contexts.map((target, i) => ({ ...recognition(i), target, answerCaseId: target.family === "f2l" ? target.caseName : target.caseId }));
    for (const context of [{ family: "f2l", library: "basic", position: "FR" }, { family: "oll", trainingSet: "full" }, { family: "pll", trainingSet: "2look" }] as const) {
      const scoped = trainingContextHistory(rows, answers, context), analytics = trainingAnalytics(scoped.execution, scoped.recognition, scoped.catalogue!);
      expect(analytics.cases.length).toBe(scoped.catalogue!.length);
      expect(analytics.cases.every(c => c.target.family === context.family)).toBe(true);
      expect(analytics.execution.attempts).toBe(scoped.catalogue!.length);
      expect(trainingTrends(scoped.execution, scoped.recognition, "all").execution).toHaveLength(scoped.catalogue!.length);
    }
  });
  it("includes unpractised catalogue cases and groups with New status and unavailable metrics", () => {
    const catalogue = trainingInsightsCatalogue(), a = trainingAnalytics([], [], catalogue);
    expect(a.cases).toHaveLength(catalogue.length);
    expect(a.cases.every(c => c.execution.status === "new" && c.recognition.status === "new" &&
      c.lastPracticedAt === null && c.recognition.accuracy === null && c.personal.matchRate === null)).toBe(true);
    expect(a.groups.length).toBeGreaterThan(0);
    expect(a.groups.every(g => g.execution.attempts === 0 && g.execution.medianCaseTimeMs === null && g.recognition.accuracy === null)).toBe(true);
    expect(catalogue).toContainEqual({ family: "f2l", library: "advanced", position: "BL", caseName: "AF2L 4" });
    expect(catalogue).toContainEqual({ family: "oll", trainingSet: "2look", caseId: "Sune" });
  });
  it("uses historical benchmark snapshots, shares execution aggregation, and retains distinct dimensions", () => {
    const a = trainingAnalytics([execution(0), execution(1, { preferredStm: 10, matchedPreferred: true, preferredDelta: 0 }),
      execution(2, { preferredStm: 9, matchedPreferred: false, preferredDelta: 1 })], [recognition(0), recognition(1, false)]);
    expect(a.execution).toMatchObject({ attempts: 3, medianMoveSpanMs: 600, medianCaseTimeMs: 1100, bestCaseTimeMs: 1000,
      recentMedianDelta: 1, canonicalMatchRate: 1, personal: { attempts: 2, matched: 1, matchRate: 0.5, medianDelta: 0.5 } });
    expect(a.recognition).toMatchObject({ attempts: 2, correct: 1, incorrect: 1, accuracy: 0.5, medianCorrectResponseMs: 1000 });
    expect(a.cases).toHaveLength(1); expect(a.groups[0].execution.recentMedianDelta).toBe(1);
    expect(a.confusions).toEqual([{ target: recognition(0).target, answerCaseId: "26", count: 1 }]);
  });
  it("does not fabricate unavailable values or mix catalogue contexts", () => {
    const empty = trainingAnalytics([], []); expect(empty.execution.medianMoveSpanMs).toBeNull(); expect(empty.execution.personal.matchRate).toBeNull();
    expect(empty.recognition.accuracy).toBeNull(); expect(empty.progression.medianExecutionDeltaMs).toBeNull();
    const rows = [execution(0), execution(1, { target: { family: "oll", origin: "catalog", trainingSet: "2look", caseId: "Sune", auf: 0 } }),
      execution(2, { target: { family: "f2l", origin: "catalog", library: "basic", position: "FR", caseName: "F2L 4" } }),
      execution(3, { target: { family: "f2l", origin: "catalog", library: "basic", position: "FL", caseName: "F2L 4" } }),
      execution(4, { target: { family: "f2l", origin: "catalog", library: "advanced", position: "FR", caseName: "AF2L 4" } })];
    expect(trainingAnalytics(rows, []).cases).toHaveLength(5);
  });
  it("groups runs explicitly, compares halves after six rounds, and withholds sparse correct-speed conclusions", () => {
    const executions = Array.from({ length: 6 }, (_, i) => execution(i));
    const recognitions = Array.from({ length: 6 }, (_, i) => recognition(i, i < 3));
    const p = trainingRunProgression(executions.reverse(), recognitions.reverse());
    expect(p.executionRuns[0]).toMatchObject({ firstMs: 1100, secondMs: 1400, deltaMs: 300 });
    expect(p.recognitionRuns[0]).toMatchObject({ firstAccuracy: 1, secondAccuracy: 0, accuracyDelta: -1, firstMs: 1100, secondMs: null, deltaMs: null });
    expect(trainingRunProgression(executions.slice(0, 5), []).executionRuns).toEqual([]);
    expect(trainingRunProgression([execution(1, { drillRunId: null, drillRound: null })], []).executionRuns).toEqual([]);
  });
  it("orders chronological trends, limits each task separately, and leaves wrong-answer speed null", () => {
    const rows = Array.from({ length: 30 }, (_, i) => execution(i));
    const trends = trainingTrends(rows.reverse(), [recognition(1, false), recognition(0)], 25);
    expect(trends.execution).toHaveLength(25); expect(trends.execution[0].id).toBe("e5"); expect(trends.execution.at(-1)?.id).toBe("e29");
    expect(trends.recognition.map(a => a.correctResponseMs)).toEqual([1000, null]);
    expect(trainingTrends(rows, [], "all").execution).toHaveLength(30);
  });
});
