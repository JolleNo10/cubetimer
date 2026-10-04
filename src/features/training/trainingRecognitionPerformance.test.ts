import { describe, expect, it } from "vitest";
import type { TrainingRecognitionAttempt } from "../../app/types";
import { trainingCatalogueKey } from "../../app/trainingCatalogue";
import { recognitionIsCorrect, recognitionPerformance, recognitionStatsByCase } from "./trainingRecognitionPerformance";

const row = (index: number, correct = true, responseMs = 1000): TrainingRecognitionAttempt => ({
  id: String(index), createdAt: index, drillRunId: "run", drillRound: index + 1,
  target: { family: "oll", trainingSet: "full", caseId: "27" }, answerCaseId: correct ? "27" : "26", responseMs,
});
describe("Recognition historical performance", () => {
  it("keeps unavailable accuracy and correct timing null", () => {
    expect(recognitionPerformance([])).toMatchObject({ attempts: 0, accuracy: null, recentAccuracy: null, status: "new",
      bestCorrectResponseMs: null, medianCorrectResponseMs: null });
    expect(recognitionPerformance([row(1, false)])).toMatchObject({ accuracy: 0, correct: 0, incorrect: 1, status: "learning",
      bestCorrectResponseMs: null, recentMedianCorrectResponseMs: null });
  });
  it("uses latest five answers for accuracy and excludes wrong response times from speed", () => {
    const rows = [row(0, false, 90000), ...Array.from({ length: 5 }, (_, i) => row(i + 1, true, 1000))];
    expect(recognitionPerformance(rows.reverse())).toMatchObject({ attempts: 6, correct: 5, accuracy: 5 / 6,
      recentAccuracy: 1, recentWrongCount: 0, bestCorrectResponseMs: 1000, recentMedianCorrectResponseMs: 1000, status: "practiced" });
  });
  it("uses review thresholds only after three attempts, including timing regression", () => {
    expect(recognitionPerformance([row(0, false), row(1, false)])).toMatchObject({ status: "learning" });
    expect(recognitionPerformance([row(0), row(1, false), row(2)])).toMatchObject({ status: "review" });
    expect(recognitionPerformance([row(0), row(1, true, 1300), row(2, true, 1400)])).toMatchObject({ status: "review" });
    expect(recognitionPerformance([row(0, true, 0)])).toMatchObject({ bestCorrectResponseMs: 0 });
  });
  it("shares durable catalogue identity without mixing Full/2-Look or F2L positions", () => {
    const full = row(0), twoLook: TrainingRecognitionAttempt = { ...row(1), target: { family: "oll", trainingSet: "2look", caseId: "Sune" }, answerCaseId: "Sune" };
    const f2l: TrainingRecognitionAttempt = { ...row(2), target: { family: "f2l", library: "basic", position: "FR", caseName: "F2L 4" }, answerCaseId: "F2L 4" };
    const fl: TrainingRecognitionAttempt = { ...f2l, id: "FL", target: { ...f2l.target, position: "FL" } as typeof f2l.target };
    const stats = recognitionStatsByCase([full, twoLook, f2l, fl]);
    expect(stats.size).toBe(4); expect(stats.get(trainingCatalogueKey(full.target))?.attempts).toBe(1);
    expect(recognitionIsCorrect(f2l)).toBe(true); expect(recognitionIsCorrect({ ...f2l, answerCaseId: "F2L 5" })).toBe(false);
  });
});
