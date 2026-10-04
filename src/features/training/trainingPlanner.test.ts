import { describe, expect, it } from "vitest";
import { trainingCatalogueCaseId } from "../../app/trainingCatalogue";
import { trainingCurriculum } from "./trainingCurriculum";
import { trainingPlan } from "./trainingPlanner";
import { DAY, executionEvidence as e, recognitionEvidence as r, policyContext as context, policyTargets as targets } from "./trainingPolicy.testFixtures";
const id = (index: number) => trainingCatalogueCaseId(targets[index]);
describe("Guided Training planner", () => {
  it("introduces four New cases with Recognition Sequence in the exact context", () => {
    const c = trainingCurriculum(context, [], [], 0), plan = trainingPlan(c, "learn");
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toMatchObject({ context, task: "recognition", strategy: "sequence", caseIds: targets.slice(0, 4).map(trainingCatalogueCaseId) });
    expect(trainingPlan(c, "learn")).toEqual(plan);
  });
  it("splits Recall execution from early recognition work without a mixed-task run", () => {
    const plan = trainingPlan(trainingCurriculum(context, [], r(targets[0], 3), 0), "learn");
    expect(plan.blocks.map(b => b.task)).toEqual(["recognition", "execution"]);
    expect(plan.blocks[1]).toMatchObject({ strategy: "sequence", caseIds: [id(0)] });
    expect(plan.blocks[0].caseIds).toHaveLength(4);
  });
  it("adds same-group recognition support inside the catalogue, without marking it weak", () => {
    const c = trainingCurriculum(context, [], r(targets[0], 3, { answerCaseId: id(1) }), 0);
    const plan = trainingPlan(c, "weaknesses");
    const block = plan.blocks.find(b => b.task === "recognition")!;
    const support = c.cases.find(row => row.caseId !== id(0) && row.group === c.cases[0].group) ?? c.cases[1];
    expect(block.caseIds).toEqual([id(0), support.caseId]); expect(block.composition).toEqual({ support: 1 });
    expect(c.cases.find(row => row.caseId === support.caseId)?.recognitionWeak).toBe(false);
  });
  it("mixes exactly five weak, three due, two slow and two retention unique cases", () => {
    const now = 5 * DAY;
    const executions = targets.slice(0, 12).flatMap((target, index) => {
      const rows = e(target, 3, { delta: index < 5 ? 2 : 0 }, index < 8 ? 0 : now - 1000);
      if (index === 8 || index === 9) rows.slice(1).forEach(row => { row.caseTimeMs = 1100; });
      return rows;
    });
    const recognitions = targets.slice(0, 12).flatMap((target, index) => r(target, 3, {}, index < 8 ? 0 : now - 1000));
    const plan = trainingPlan(trainingCurriculum(context, executions, recognitions, now), "review");
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toMatchObject({ task: "execution", strategy: "weighted", composition: { weak: 5, due: 3, slow: 2, retention: 2 } });
    expect(plan.blocks[0].caseIds).toEqual(targets.slice(0, 12).map(trainingCatalogueCaseId));
    expect(new Set(plan.blocks.flatMap(b => b.caseIds)).size).toBe(12);
  });
  it("fills shortages from later eligible categories and deduplicates overlapping weak/due/slow", () => {
    const execution = targets.slice(0, 15).flatMap(t => e(t, 3)), recognition = targets.slice(0, 15).flatMap(t => r(t, 3));
    const plan = trainingPlan(trainingCurriculum(context, execution, recognition, 2 * DAY), "review");
    expect(plan.blocks[0].caseIds).toHaveLength(8); // Weak quota flows into due; slow/retention have no eligible cases.
    expect(new Set(plan.blocks[0].caseIds).size).toBe(8);
    const overlapping = trainingPlan(trainingCurriculum(context, targets.slice(0, 15).flatMap(t => e(t, 3, { delta: 2 })), recognition, 2 * DAY), "review");
    expect(overlapping.blocks[0].caseIds).toHaveLength(8); expect(new Set(overlapping.blocks[0].caseIds).size).toBe(8);
  });
  it("splits review by independent weakness and keeps support within the twelve unique maximum", () => {
    const execution = targets.slice(0, 15).flatMap(t => e(t, 3, {}, DAY));
    const recognition = targets.slice(0, 15).flatMap((t, i) => r(t, 3, i === 0 ? { answerCaseId: id(1) } : {}, DAY));
    const plan = trainingPlan(trainingCurriculum(context, execution, recognition, DAY), "review");
    const rec = plan.blocks.find(b => b.task === "recognition")!, exe = plan.blocks.find(b => b.task === "execution")!;
    expect(rec.caseIds).toHaveLength(2); expect(exe.caseIds).not.toContain(id(0));
    expect(new Set(plan.blocks.flatMap(b => b.caseIds)).size).toBeLessThanOrEqual(12);
    const independent = trainingPlan(trainingCurriculum(context, e(targets[0], 3, { delta: 2 }), r(targets[0], 3, { answerCaseId: id(1) }), 0), "review");
    expect(independent.blocks.every(b => b.caseIds.includes(id(0)))).toBe(true);
  });
  it("Speed excludes introductory stages, caps at eight and prioritizes timing then effective efficiency", () => {
    const executions = targets.slice(0, 12).flatMap((t, i) => {
      const rows = e(t, i < 2 ? 1 : 5, { delta: i === 4 ? 99 : 0, preferredDelta: i === 4 ? 0 : null }, i);
      if (i === 3) rows.slice(1).forEach(a => { a.caseTimeMs = 1300; });
      return rows;
    });
    const recognition = targets.slice(0, 12).flatMap((t, i) => r(t, i === 0 ? 0 : i === 1 ? 1 : 5));
    const plan = trainingPlan(trainingCurriculum(context, executions, recognition, 0), "speed");
    expect(plan.blocks[0].caseIds).toHaveLength(8); expect(plan.blocks[0].caseIds[0]).toBe(id(3));
    expect(plan.blocks[0].caseIds).not.toContain(id(0)); expect(plan.blocks[0].caseIds).not.toContain(id(1));
    expect(trainingPlan(trainingCurriculum(context, [], [], 0), "speed")).toMatchObject({ blocks: [], explanation: "Build reliable recognition and execution first." });
  });
  it("prioritizes explicit confusions/errors and snapshot effective delta, bounds each weakness task", () => {
    const executions = targets.slice(0, 12).flatMap((t, i) => e(t, 5, { delta: 50, preferredDelta: i === 3 ? 8 : i === 4 ? 0 : 1 }));
    const recognition = targets.slice(0, 12).flatMap((t, i) => r(t, i === 2 ? 8 : 3, { answerCaseId: id(20) }));
    const plan = trainingPlan(trainingCurriculum(context, executions, recognition, 0), "weaknesses");
    const rec = plan.blocks.find(b => b.task === "recognition")!, exe = plan.blocks.find(b => b.task === "execution")!;
    expect(rec.caseIds).toHaveLength(8); expect(rec.caseIds[0]).toBe(id(2));
    expect(exe.caseIds).toHaveLength(8); expect(exe.caseIds[0]).toBe(id(3)); expect(exe.caseIds).not.toContain(id(4));
  });
  it("Competition uses established due coverage first, with justified warm-up and no new cases", () => {
    const execution = targets.slice(0, 15).flatMap((t, i) => e(t, i === 0 ? 1 : 3, {}, i === 5 ? 0 : 2 * DAY));
    const recognition = targets.slice(0, 15).flatMap((t, i) => r(t, i === 0 ? 1 : 3, {}, i === 5 ? 0 : 2 * DAY));
    const c = trainingCurriculum(context, execution, recognition, 2 * DAY), plan = trainingPlan(c, "competition");
    expect(plan.blocks.map(b => b.task)).toEqual(["recognition", "execution"]);
    const exe = plan.blocks[1]; expect(exe.caseIds[0]).toBe(id(5)); expect(exe.caseIds).toHaveLength(12); expect(exe.caseIds).not.toContain(id(0));
    const fresh = trainingPlan(trainingCurriculum(context, e(targets[0], 3), r(targets[0], 3), 0), "competition");
    expect(fresh.blocks.map(b => b.task)).toEqual(["execution"]);
  });
  it("never returns an invalid one-case recognition block in a defensive one-case catalogue", () => {
    const c = trainingCurriculum(context, [], [], 0); c.cases = c.cases.slice(0, 1); c.activeCohort = c.cases;
    expect(trainingPlan(c, "learn").blocks).toEqual([]);
  });
  it("Competition recognition support never introduces a New case", () => {
    const plan = trainingPlan(trainingCurriculum(context, e(targets[0], 3), r(targets[0], 3), 2 * DAY), "competition");
    expect(plan.blocks.map(b => b.task)).toEqual(["execution"]);
    expect(plan.blocks[0].caseIds).toEqual([id(0)]);
  });
  it("uses independent personal recognition and execution timing weaknesses", () => {
    const executions = e(targets[1], 5), recognitions = r(targets[0], 5);
    executions.slice(1).forEach(a => { a.caseTimeMs = 1400; }); recognitions.slice(1).forEach(a => { a.responseMs = 1400; });
    const plan = trainingPlan(trainingCurriculum(context, executions, recognitions, 0), "weaknesses");
    expect(plan.blocks.find(b => b.task === "recognition")?.caseIds).toContain(id(0));
    expect(plan.blocks.find(b => b.task === "execution")?.caseIds).toEqual([id(1)]);
  });
});
