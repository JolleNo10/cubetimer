import type { TrainingDrillPresetContext, TrainingDrillStrategy, TrainingDrillTask } from "../../app/types";
import { recognitionCasePool } from "./trainingDrill";
import { isEstablishedTrainingCase, type TrainingCurriculum, type TrainingCurriculumCase } from "./trainingCurriculum";

export type TrainingGuidedMode = "learn" | "review" | "speed" | "weaknesses" | "competition";
export type TrainingPlanBlock = {
  id: string; label: string; reason: string; context: TrainingDrillPresetContext;
  task: TrainingDrillTask; strategy: TrainingDrillStrategy; caseIds: string[];
  composition?: { weak?: number; due?: number; slow?: number; retention?: number; support?: number };
};
type Case = TrainingCurriculumCase;
type Category = "weak" | "due" | "slow" | "retention";
const older = (a: Case, b: Case) => (a.lastPracticedAt ?? -Infinity) - (b.lastPracticedAt ?? -Infinity) ||
  a.order - b.order || a.key.localeCompare(b.key);
const recognitionNeed = (c: Case) => c.recognitionWeak || c.confusionCount > 0 || (c.introduced && c.recognition.attempts < 3);
const executionNeed = (c: Case) => c.executionWeak || (c.recognition.status === "practiced" && c.execution.attempts < 3);
const recognitionOrder = (a: Case, b: Case) => b.confusionCount - a.confusionCount ||
  b.recognition.recentWrongCount - a.recognition.recentWrongCount || (a.recognition.recentAccuracy ?? 1) - (b.recognition.recentAccuracy ?? 1) ||
  Number(b.recognition.status === "review") - Number(a.recognition.status === "review") ||
  (b.recognitionTimingRatio ?? 1) - (a.recognitionTimingRatio ?? 1) || older(a, b);
const executionOrder = (a: Case, b: Case) => Number(b.execution.status === "review") - Number(a.execution.status === "review") ||
  Math.max(0, b.execution.recentMedianDelta ?? 0) - Math.max(0, a.execution.recentMedianDelta ?? 0) ||
  (b.executionTimingRatio ?? 1) - (a.executionTimingRatio ?? 1) || older(a, b);
const speedOrder = (a: Case, b: Case) => (b.executionTimingRatio ?? 1) - (a.executionTimingRatio ?? 1) ||
  Math.max(0, b.execution.recentMedianDelta ?? 0) - Math.max(0, a.execution.recentMedianDelta ?? 0) ||
  (a.execution.lastPracticedAt ?? -Infinity) - (b.execution.lastPracticedAt ?? -Infinity) || a.order - b.order;

/** Every output is a valid ordinary fixed-task Drill configuration, never a run. */
export function trainingPlan(curriculum: TrainingCurriculum, mode: TrainingGuidedMode) {
  const { context, cases, activeCohort } = curriculum, blocks: TrainingPlanBlock[] = [];
  const add = (task: TrainingDrillTask, selected: readonly Case[], label: string, reason: string,
    strategy: TrainingDrillStrategy = "weighted", composition?: TrainingPlanBlock["composition"], supportCases: readonly Case[] = cases) => {
    if (!selected.length) return;
    const pool = task === "recognition" ? recognitionCasePool(supportCases.map(c => c.target), selected.map(c => c.caseId)) :
      { caseIds: selected.map(c => c.caseId), supportCaseId: null };
    if (!pool) return;
    // Preserve recommendation ranking; Sequence still executes in catalogue order.
    const caseIds = [...selected.map(c => c.caseId), ...(pool.supportCaseId ? [pool.supportCaseId] : [])];
    blocks.push({ id: `${mode}-${task}`, label, reason, context, task, strategy, caseIds,
      composition: pool.supportCaseId ? { ...composition, support: 1 } : composition });
  };
  const established = cases.filter(isEstablishedTrainingCase);
  if (mode === "learn") {
    if (activeCohort.some(c => c.stage === "new" || c.stage === "learning" || c.recognition.status === "review"))
      add("recognition", activeCohort, "Build recognition", "Active learning cohort: introduce a few cases and recognise them reliably.", "sequence");
    add("execution", activeCohort.filter(c => c.stage === "recall" && c.recognition.status === "practiced"),
      "Build execution", "Recognition is established; build dependable execution.", "sequence");
  } else if (mode === "weaknesses") {
    add("recognition", cases.filter(recognitionNeed).sort(recognitionOrder).slice(0, 8), "Recognition weaknesses",
      "Explicit confusions, recent errors, missing recognition and personal timing regression.");
    add("execution", cases.filter(executionNeed).sort(executionOrder).slice(0, 8), "Execution weaknesses",
      "Execution review, missing execution, historical effective STM delta and personal timing regression.");
  } else if (mode === "speed") {
    add("execution", established.sort(speedOrder).slice(0, 8), "Speed practice",
      "Established cases ordered by personal execution regression, efficiency and least-recent execution.");
  } else if (mode === "competition") {
    const ordered = established.sort((a, b) => Number(b.due) - Number(a.due) ||
      Number(b.recognitionWeak || b.executionWeak) - Number(a.recognitionWeak || a.executionWeak) || older(a, b));
    add("recognition", ordered.filter(c => recognitionNeed(c) || c.due).slice(0, 4), "Recognition warm-up",
      "Established cases with recognition weakness or review due.", "weighted", undefined, established);
    add("execution", ordered.slice(0, 12), "Competition coverage", "Due established cases, weaknesses, then least-recent retention coverage.");
  } else {
    const weak = cases.filter(c => recognitionNeed(c) || executionNeed(c)).sort((a, b) =>
      Number(recognitionNeed(b)) - Number(recognitionNeed(a)) || (recognitionNeed(a) ? recognitionOrder(a, b) : executionOrder(a, b)));
    const due = established.filter(c => c.due).sort((a, b) => a.dueAt - b.dueAt || older(a, b));
    const slow = established.filter(c => Math.max(c.executionTimingRatio ?? 1, c.recognitionTimingRatio ?? 1) > 1)
      .sort((a, b) => Math.max(b.executionTimingRatio ?? 1, b.recognitionTimingRatio ?? 1) - Math.max(a.executionTimingRatio ?? 1, a.recognitionTimingRatio ?? 1) || older(a, b));
    const retention = established.filter(c => !c.due && !recognitionNeed(c) && !executionNeed(c)).sort(older);
    const selected: { row: Case; category: Category }[] = [], keys = new Set<string>();
    // Unfilled earlier quotas flow to later categories. No duplicate quota filler.
    let budget = 0;
    for (const [category, pool, quota] of [["weak", weak, 5], ["due", due, 3], ["slow", slow, 2], ["retention", retention, 2]] as const) {
      budget += quota;
      const capacity = budget - selected.length;
      for (const row of pool.filter(c => !keys.has(c.key)).slice(0, Math.max(0, capacity))) {
        keys.add(row.key); selected.push({ row, category });
      }
    }
    const primarilyRecognition = (row: Case, category: Category) => recognitionNeed(row) ||
      category === "slow" && (row.recognitionTimingRatio ?? 1) > (row.executionTimingRatio ?? 1);
    // Support counts toward the twelve unique review cases. Reserve it before
    // building task compositions, dropping only the lowest-priority tail if needed.
    const recognitionMembers = selected.filter(({ row, category }) => primarilyRecognition(row, category));
    if (recognitionMembers.length === 1) {
      const pool = recognitionCasePool(cases.map(c => c.target), [recognitionMembers[0].row.caseId]);
      if (pool?.supportCaseId && !selected.some(m => m.row.caseId === pool.supportCaseId) && selected.length === 12) selected.pop();
    }
    for (const task of ["recognition", "execution"] as const) {
      const members = selected.filter(({ row, category }) => task === "recognition"
        ? primarilyRecognition(row, category)
        : executionNeed(row) || !primarilyRecognition(row, category));
      const composition = Object.fromEntries((["weak", "due", "slow", "retention"] as const)
        .map(category => [category, members.filter(m => m.category === category).length]));
      add(task, members.map(m => m.row), task === "recognition" ? "Adaptive recognition" : "Adaptive execution",
        "Weak cases first, then due review, personal timing regression and retention coverage.", "weighted", composition);
    }
  }
  const explanation = blocks.length ? null : mode === "speed" || mode === "competition"
    ? "Build reliable recognition and execution first." : mode === "learn" ? "All cases are established. Try Review to maintain them." : "No current weaknesses or review work found.";
  const attention = mode === "competition" ? cases.filter(c => c.stage === "recall").map(c => c.caseId) : [];
  return { blocks, explanation, attention };
}
