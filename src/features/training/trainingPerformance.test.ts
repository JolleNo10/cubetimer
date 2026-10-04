import { describe, expect, it, vi } from "vitest";
import type { TrainingAttempt, TrainingAttemptTarget } from "../../app/types";
import { EMPTY_TRAINING_CASE_STATS, selectTrainingReview, trainingCaseKey, trainingStatsByCase, type TrainingCatalogueCase } from "./trainingPerformance";

const f2l = (caseName = "F2L 1"): TrainingCatalogueCase => ({ family: "f2l", origin: "catalog", library: "basic", position: "FR", caseName });
const a = f2l(), b = f2l("F2L 2"), c = f2l("F2L 3");
let serial = 0;
function attempt(target: TrainingCatalogueCase = a, values: Partial<TrainingAttempt> = {}): TrainingAttempt {
  return { id: String(++serial), createdAt: serial, mode: "virtual",
    target: target.family === "f2l" ? target : { ...target, auf: 0 },
    moves: ["R"], stm: 4, elapsedMs: 1000, recommendedStm: 4, matchedReferenceRank: 1, delta: 0, ...values };
}
const stats = (attempts: TrainingAttempt[], target = a) => trainingStatsByCase(attempts).get(trainingCaseKey(target)!) ?? EMPTY_TRAINING_CASE_STATS;
const practiced = (target: TrainingCatalogueCase, values: Partial<TrainingAttempt> = {}) =>
  Array.from({ length: 3 }, () => attempt(target, values));

describe("Training catalogue identity", () => {
  it("separates F2L libraries and positions", () => {
    const base = { family: "f2l", origin: "catalog", library: "basic", position: "FR", caseName: "F2L 1" } as const;
    expect(trainingCaseKey(base)).not.toBe(trainingCaseKey({ ...base, library: "advanced" }));
    expect(trainingCaseKey(base)).not.toBe(trainingCaseKey({ ...base, position: "FL" }));
  });
  it("separates last-layer family and set but aggregates AUF variants", () => {
    const base = { family: "oll", origin: "catalog", trainingSet: "full", caseId: "27", auf: 0 } as const;
    expect(trainingCaseKey(base)).not.toBe(trainingCaseKey({ ...base, family: "pll" }));
    expect(trainingCaseKey(base)).not.toBe(trainingCaseKey({ ...base, trainingSet: "2look" }));
    expect(trainingCaseKey(base)).toBe(trainingCaseKey({ ...base, auf: 3 }));
  });
  it("gives exact historical practice no catalogue key", () => {
    const target: TrainingAttemptTarget = { family: "f2l", origin: "solve-step", solveId: "missing", stepName: "F2L Slot 1", position: "FR", recognizedCaseName: "F2L 1" };
    expect(trainingCaseKey(target)).toBeNull();
    expect(trainingStatsByCase([attempt(a, { target })]).size).toBe(0);
  });
});

describe("Training per-case performance", () => {
  it("counts attempts, ignores invalid/nonpositive times, and keeps best STM and last practice", () => {
    const rows = [attempt(a, { elapsedMs: 0 }), attempt(a, { elapsedMs: NaN }), attempt(a, { elapsedMs: -10 }),
      attempt(a, { elapsedMs: 800, stm: 3, createdAt: 20 }), attempt(a, { elapsedMs: 1200, stm: 5, createdAt: 10 })];
    expect(stats(rows)).toMatchObject({ attempts: 5, bestElapsedMs: 800, bestStm: 3, lastPracticedAt: 20, recentMedianElapsedMs: 1000 });
  });
  it("uses only the most recent five with odd median and ignores null deltas", () => {
    const rows = [100, 200, 1000, 3000, 2000, 4000, 5000].map((elapsedMs, i) =>
      attempt(a, { elapsedMs, createdAt: i, delta: i < 2 ? -100 : i === 2 ? null : i - 3 }));
    expect(stats(rows.reverse())).toMatchObject({ bestElapsedMs: 100, recentMedianElapsedMs: 3000, recentMedianDelta: 1.5,
      recentElapsedMs: [1000, 3000, 2000, 4000, 5000] });
  });
  it("uses the mean of middle values for even medians, including half STM deltas", () => {
    expect(stats([attempt(a, { elapsedMs: 800, delta: 1 }), attempt(a, { elapsedMs: 1200, delta: 2 })]))
      .toMatchObject({ recentMedianElapsedMs: 1000, recentMedianDelta: 1.5, status: "learning" });
  });
  it("keeps unavailable metrics null and does not turn null delta into zero", () => {
    expect(stats(practiced(a, { elapsedMs: 0, delta: null }))).toMatchObject({ bestElapsedMs: null, recentMedianElapsedMs: null, recentMedianDelta: null });
  });
  it("labels New/Learning/Review/Practised with the exact transparent thresholds", () => {
    expect(stats([]).status).toBe("new");
    expect(stats([attempt(), attempt()]).status).toBe("learning");
    expect(stats(practiced(a)).status).toBe("practiced");
    expect(stats(practiced(a, { delta: 1 })).status).toBe("review");
    expect(stats([attempt(a, { elapsedMs: 1000 }), attempt(a, { elapsedMs: 1200 }), attempt(a, { elapsedMs: 1200 })]).status).toBe("practiced");
    expect(stats([attempt(a, { elapsedMs: 1000 }), attempt(a, { elapsedMs: 1201 }), attempt(a, { elapsedMs: 1201 })]).status).toBe("review");
  });
});

describe("adaptive Training review selection", () => {
  it("chooses uniformly among unseen with supplied RNG before any seen case", () => {
    const random = vi.fn(() => 0.99);
    expect(selectTrainingReview([a, b, c], a, practiced(a, { delta: 10 }), random)).toEqual(c);
    expect(random).toHaveBeenCalledOnce();
    expect(selectTrainingReview([a, b, c], a, practiced(a), () => 0)).toEqual(b);
  });
  it("never skips an unseen current case in favor of a lower tier", () => {
    expect(selectTrainingReview([a, b], a, practiced(b))).toEqual(a);
  });
  it("chooses the lowest count then oldest, with stable catalogue-order ties", () => {
    const rows = [...practiced(a), attempt(b, { createdAt: 5 }), attempt(c, { createdAt: 2 })];
    expect(selectTrainingReview([a, b, c], null, rows)).toEqual(c);
    rows.at(-1)!.createdAt = 5;
    expect(selectTrainingReview([a, b, c], null, rows)).toEqual(b);
    expect(selectTrainingReview([a, b, c], b, rows)).toEqual(c);
  });
  it("prioritizes larger positive efficiency delta before time regression and maintenance", () => {
    const rows = [...practiced(a, { delta: 2 }), ...practiced(b, { delta: 3 }), ...practiced(c, { createdAt: 0 })];
    expect(selectTrainingReview([a, b, c], null, rows)).toEqual(b);
  });
  it("orders equally efficient review cases by time regression, then oldest", () => {
    const regressed = (target: TrainingCatalogueCase, ms: number) => [attempt(target, { elapsedMs: 1000 }),
      ...Array.from({ length: 5 }, () => attempt(target, { elapsedMs: ms }))];
    expect(selectTrainingReview([a, b], null, [...regressed(a, 1300), ...regressed(b, 1500)])).toEqual(b);
    expect(selectTrainingReview([a, b], null, [...practiced(a, { delta: 1, createdAt: 10 }), ...practiced(b, { delta: 1, createdAt: 5 })])).toEqual(b);
  });
  it("ranks unavailable metrics behind known poor performance", () => {
    const rows = [...practiced(a, { delta: 1 }), attempt(b, { elapsedMs: 1000, delta: null }),
      attempt(b, { elapsedMs: 2000, delta: null }), attempt(b, { elapsedMs: 2000, delta: null })];
    expect(selectTrainingReview([a, b], null, rows)).toEqual(a);
  });
  it("chooses oldest for maintenance, avoiding the current case within the same tier", () => {
    const rows = [...practiced(a, { createdAt: 5 }), ...practiced(b, { createdAt: 1 })];
    expect(selectTrainingReview([a, b], null, rows)).toEqual(b);
    expect(selectTrainingReview([a, b], b, rows)).toEqual(a);
  });
  it("ignores solve-step history and supports a single case or empty catalogue", () => {
    const exact = attempt(a, { target: { family: "oll", origin: "solve-step", trainingSet: "full", caseId: "27", auf: 0, solveId: "absent", stepName: "OLL" } });
    expect(selectTrainingReview([a, b], a, [exact], () => 0)).toEqual(b);
    expect(selectTrainingReview([a], a, practiced(a))).toEqual(a);
    expect(selectTrainingReview([], null, [])).toBeNull();
  });
});
