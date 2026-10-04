import { describe, expect, it } from "vitest";
import { trainingCatalogueCaseId, trainingCatalogueKey } from "../../app/trainingCatalogue";
import type { TrainingDrillPresetContext } from "../../app/types";
import { trainingCurriculum } from "./trainingCurriculum";
import { DAY, executionEvidence as e, recognitionEvidence as r, policyContext as context, policyTargets as targets } from "./trainingPolicy.testFixtures";

const first = (execution = e(), recognition = r(), now = 0) => trainingCurriculum(context, execution, recognition, now).cases[0];
describe("Derived Training curriculum", () => {
  it("uses exact New, Learning, Recall and Reliable boundaries", () => {
    expect(first([], []).stage).toBe("new");
    expect(first(e(), []).stage).toBe("learning");
    for (const count of [1, 2]) expect(first([], r(targets[0], count)).stage).toBe("learning");
    expect(first(e(), r(targets[0], 3, { answerCaseId: trainingCatalogueCaseId(targets[1]) })).stage).toBe("recall");
    expect(first(e(targets[0], 2), r(targets[0], 3)).stage).toBe("recall");
    expect(first(e(targets[0], 3), r(targets[0], 3)).stage).toBe("reliable");
  });
  it("passes Fast exactly at five attempts, perfect recent accuracy, 1.15 timing and zero effective delta", () => {
    const executions = e(), recognitions = r();
    executions[0].caseTimeMs = 1000; executions.slice(1).forEach(a => { a.caseTimeMs = 1150; });
    recognitions.slice(1).forEach(a => { a.responseMs = 1150; });
    expect(first(executions, recognitions)).toMatchObject({ stage: "fast", executionTimingRatio: 1.15, recognitionTimingRatio: 1.15 });
  });
  it.each(["execution count", "recognition count", "accuracy", "recognition timing", "execution timing", "effective delta"])("fails Fast for %s", criterion => {
    const executions = e(targets[0], criterion === "execution count" ? 4 : 5), recognitions = r(targets[0], criterion === "recognition count" ? 4 : 5);
    if (criterion === "accuracy") recognitions[4].answerCaseId = trainingCatalogueCaseId(targets[1]);
    if (criterion === "recognition timing") recognitions.slice(1).forEach(a => { a.responseMs = 1151; });
    if (criterion === "execution timing") executions.slice(1).forEach(a => { a.caseTimeMs = 1151; });
    if (criterion === "effective delta") executions.forEach(a => { a.delta = 1; });
    expect(first(executions, recognitions).stage).toBe("reliable");
  });
  it("requires ten attempts in each dimension and seven elapsed days for Maintenance", () => {
    expect(first(e(targets[0], 10, {}, 0, 7 * DAY), r(targets[0], 10, {}, 0, 7 * DAY)).stage).toBe("maintenance");
    expect(first(e(targets[0], 10, {}, 0, 7 * DAY - 1), r(targets[0], 10)).stage).toBe("fast");
    expect(first(e(targets[0], 9, {}, 0, 7 * DAY), r(targets[0], 10)).stage).toBe("fast");
    expect(first(e(targets[0], 10, {}, 0, 7 * DAY), r(targets[0], 9)).stage).toBe("fast");
  });
  it("regresses high stages from recent correctness and efficiency evidence", () => {
    const executions = e(targets[0], 10, {}, 0, 7 * DAY), recognitions = r(targets[0], 10, {}, 0, 7 * DAY);
    expect(first(executions, recognitions).stage).toBe("maintenance");
    expect(first(executions, [...recognitions, ...r(targets[0], 5, { answerCaseId: trainingCatalogueCaseId(targets[1]) }, 8 * DAY)]).stage).toBe("recall");
    expect(first([...executions, ...e(targets[0], 5, { delta: 2 }, 8 * DAY)], recognitions).stage).toBe("reliable");
  });
  it("retains null timing and accepts unavailable timing for Fast without NaN or Infinity", () => {
    const c = first(e(targets[0], 5, { elapsedMs: 0, caseTimeMs: 0, delta: 20, preferredDelta: 0 }), r(targets[0], 5, { responseMs: 0 }));
    expect(c).toMatchObject({ stage: "fast", executionTimingRatio: null, recognitionTimingRatio: null, execution: { recentMedianDelta: 0 } });
    const invalid = first(e(targets[0], 5, { elapsedMs: NaN, caseTimeMs: Infinity, delta: NaN }), r(targets[0], 5, { responseMs: Infinity }));
    expect(invalid).toMatchObject({ stage: "fast", executionTimingRatio: null, recognitionTimingRatio: null });
    expect(invalid.recognition.bestCorrectResponseMs).toBeNull();
  });
  it.each([[3, 0, DAY], [5, 0, 3 * DAY], [10, 7 * DAY, 14 * DAY]])("derives due timestamps from stage, count %i", (count, span, dueAt) => {
    const execution = e(targets[0], count, {}, 0, span), recognition = r(targets[0], count, {}, 0, span);
    expect(first(execution, recognition, dueAt - 1)).toMatchObject({ due: false, dueAt });
    expect(first(execution, recognition, dueAt)).toMatchObject({ due: true, dueAt });
  });
  it("makes New, Learning and Recall due now without calendar buckets", () => {
    for (const c of [first([], [], 123), first(e(), r(targets[0], 2), 123), first([], r(), 123)]) expect(c).toMatchObject({ due: true, dueAt: 123 });
  });
  it("keeps independent catalogue contexts while AUF aggregates and exact practice is excluded", () => {
    const contexts: TrainingDrillPresetContext[] = [
      { family: "f2l", library: "basic", position: "FR" }, { family: "f2l", library: "basic", position: "FL" },
      { family: "f2l", library: "advanced", position: "FR" }, { family: "oll", trainingSet: "full" }, { family: "oll", trainingSet: "2look" },
      { family: "pll", trainingSet: "full" }, { family: "pll", trainingSet: "2look" }];
    const identities = contexts.map(ctx => trainingCurriculum(ctx, [], [], 0).cases[0].target);
    const executions = identities.flatMap((target, i) => e(target, i + 1));
    contexts.forEach((ctx, i) => expect(trainingCurriculum(ctx, executions, [], 0).cases[0].execution.attempts).toBe(i + 1));
    expect(new Set(identities.map(trainingCatalogueKey)).size).toBe(7);
    const exact = e(targets[0], 1, { target: { family: "pll", origin: "solve-step", solveId: "solve", stepName: "PLL", trainingSet: "full", caseId: "T", auf: 0 } });
    expect(trainingCurriculum(context, exact, [], 0).cases.every(c => c.stage === "new")).toBe(true);
  });
  it("prioritizes individually introduced later cases and fills only four earliest New slots", () => {
    const later = targets[15];
    const curriculum = trainingCurriculum(context, e(later, 1), [], 0);
    expect(curriculum.activeCohort.map(c => c.key)).toEqual([later, ...targets.slice(0, 3)].map(trainingCatalogueKey));
    expect(curriculum.cases.filter(c => c.introduced)).toHaveLength(1);
    const advanced = trainingCurriculum(context, [...e(later, 3), ...e(targets[0], 3)], [...r(later, 3), ...r(targets[0], 3)], 0);
    expect(advanced.activeCohort.map(c => c.key)).toEqual(targets.slice(1, 5).map(trainingCatalogueKey));
  });
  it("bounds introduced Learning/Recall cohort to four and puts review evidence first", () => {
    const executions = targets.slice(0, 7).flatMap(t => e(t, 1));
    const recognitions = r(targets[6], 3, { answerCaseId: trainingCatalogueCaseId(targets[0]) });
    const cohort = trainingCurriculum(context, executions, recognitions, 0).activeCohort;
    expect(cohort).toHaveLength(4); expect(cohort[0].key).toBe(trainingCatalogueKey(targets[6]));
  });
});
