import type { TrainingAttempt, TrainingCatalogueIdentity, TrainingDrillPresetContext, TrainingRecognitionAttempt } from "../../app/types";
import { normalizeTrainingCatalogueIdentity, trainingCatalogueCaseIds, trainingCatalogueKey } from "../../app/trainingCatalogue";
import { F2L_POSITIONS } from "../../cube/f2lCases";
import { drillCaseMetadata } from "./trainingDrill";
import { trainingExecutionPerformance, trainingStatsByCase } from "./trainingPerformance";
import { recognitionIsCorrect, recognitionPerformance, recognitionStatsByCase, trainingMedian } from "./trainingRecognitionPerformance";

const chronological = <T extends { createdAt: number; id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
const medianOf = (values: readonly (number | null)[]) => trainingMedian(values.filter((n): n is number => n !== null));
const bestOf = (values: readonly number[]) => values.length ? values.reduce((best, value) => Math.min(best, value)) : null;
const rate = (matched: number, total: number) => total ? matched / total : null;

/** Enumerate identities from catalogue authorities, including cases with no history. */
export function trainingInsightsCatalogue(): TrainingCatalogueIdentity[] {
  const contexts: TrainingDrillPresetContext[] = [];
  for (const library of ["basic", "advanced"] as const) {
    for (const position of F2L_POSITIONS) contexts.push({ family: "f2l", library, position });
  }
  for (const family of ["oll", "pll"] as const) {
    for (const trainingSet of ["full", "2look"] as const) contexts.push({ family, trainingSet });
  }
  return contexts.flatMap(context => trainingCatalogueCaseIds(context).map(id => context.family === "f2l"
    ? { ...context, caseName: id } : { ...context, caseId: id }));
}

export function personalBenchmarkPerformance(attempts: readonly TrainingAttempt[]) {
  const personal = attempts.filter(a => a.preferredStm !== null && a.matchedPreferred !== null);
  const matched = personal.filter(a => a.matchedPreferred).length;
  return { attempts: personal.length, matched, matchRate: rate(matched, personal.length),
    medianDelta: medianOf(personal.map(a => a.preferredDelta)) };
}

export function executionAnalytics(attempts: readonly TrainingAttempt[]) {
  const stats = trainingExecutionPerformance(attempts);
  const spans = attempts.map(a => a.elapsedMs), caseTimes = attempts.filter(a => a.activity === "drill")
    .map(a => a.caseTimeMs).filter((n): n is number => n !== null);
  const comparable = attempts.filter(a => a.recommendedStm !== null);
  return { ...stats, medianMoveSpanMs: trainingMedian(spans), bestMoveSpanMs: bestOf(spans),
    medianCaseTimeMs: trainingMedian(caseTimes), bestCaseTimeMs: bestOf(caseTimes),
    canonicalMatchRate: rate(comparable.filter(a => a.matchedReferenceRank !== null).length, comparable.length),
    personal: personalBenchmarkPerformance(attempts) };
}

function byRun<T extends { drillRunId: string | null; drillRound: number | null; createdAt: number; id: string }>(rows: readonly T[]) {
  const runs = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.drillRunId || row.drillRound === null) continue;
    const run = runs.get(row.drillRunId) ?? []; run.push(row); runs.set(row.drillRunId, run);
  }
  return [...runs].map(([id, rows]) => ({ id, rows: chronological(rows).sort((a, b) => a.drillRound! - b.drillRound!) }));
}

export function trainingRunProgression(execution: readonly TrainingAttempt[], recognition: readonly TrainingRecognitionAttempt[]) {
  const executionRuns = byRun(execution.filter(a => a.activity === "drill" && a.caseTimeMs !== null))
    .filter(run => run.rows.length >= 6).map(run => {
      const middle = Math.floor(run.rows.length / 2), first = run.rows.slice(0, middle), second = run.rows.slice(middle);
      const firstMs = medianOf(first.map(a => a.caseTimeMs))!, secondMs = medianOf(second.map(a => a.caseTimeMs))!;
      const firstStmDelta = medianOf(first.map(a => a.preferredDelta ?? a.delta));
      const secondStmDelta = medianOf(second.map(a => a.preferredDelta ?? a.delta));
      return { id: run.id, rounds: run.rows.length, firstMs, secondMs, deltaMs: secondMs - firstMs,
        stmDelta: firstStmDelta !== null && secondStmDelta !== null ? secondStmDelta - firstStmDelta : null };
    });
  const recognitionRuns = byRun(recognition).filter(run => run.rows.length >= 6).map(run => {
    const middle = Math.floor(run.rows.length / 2), first = recognitionPerformance(run.rows.slice(0, middle)),
      second = recognitionPerformance(run.rows.slice(middle));
    return { id: run.id, rounds: run.rows.length, firstAccuracy: first.accuracy!, secondAccuracy: second.accuracy!,
      accuracyDelta: second.accuracy! - first.accuracy!,
      firstMs: first.correct >= 2 ? first.medianCorrectResponseMs : null,
      secondMs: second.correct >= 2 ? second.medianCorrectResponseMs : null,
      deltaMs: first.correct >= 2 && second.correct >= 2 ? second.medianCorrectResponseMs! - first.medianCorrectResponseMs! : null };
  });
  return { executionRuns, recognitionRuns, medianExecutionDeltaMs: trainingMedian(executionRuns.map(r => r.deltaMs)),
    medianRecognitionDeltaMs: medianOf(recognitionRuns.map(r => r.deltaMs)),
    medianRecognitionAccuracyDelta: trainingMedian(recognitionRuns.map(r => r.accuracyDelta)) };
}

/** Histories are immutable benchmark snapshots. Today's algorithm preferences are deliberately not an input. */
export function trainingAnalytics(execution: readonly TrainingAttempt[], recognition: readonly TrainingRecognitionAttempt[],
  catalogue: readonly TrainingCatalogueIdentity[] = []) {
  const identities = new Map<string, TrainingCatalogueIdentity>();
  for (const target of [...catalogue, ...execution.filter(a => a.target.origin === "catalog").map(a => a.target), ...recognition.map(a => a.target)]) {
    const identity = normalizeTrainingCatalogueIdentity(target);
    if (identity) identities.set(trainingCatalogueKey(identity), identity);
  }
  const executionStats = trainingStatsByCase(execution), recognitionStats = recognitionStatsByCase(recognition);
  const cases = [...identities].map(([key, target]) => {
    const rows = execution.filter(a => a.target.origin === "catalog" && trainingCatalogueKey(a.target) === key);
    const recognitions = recognition.filter(a => trainingCatalogueKey(a.target) === key);
    const lastPracticedAt = [...rows, ...recognitions].reduce<number | null>((last, row) =>
      last === null ? row.createdAt : Math.max(last, row.createdAt), null);
    return { key, target, ...drillCaseMetadata(target), execution: executionStats.get(key) ?? trainingExecutionPerformance([]),
      personal: personalBenchmarkPerformance(rows), recognition: recognitionStats.get(key) ?? recognitionPerformance([]),
      lastPracticedAt };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const groupCases = new Map<string, typeof cases>();
  for (const row of cases) {
    const context = row.target.family === "f2l" ? ["f2l", row.target.library, row.target.position] : [row.target.family, row.target.trainingSet];
    const key = JSON.stringify([...context, row.group]), members = groupCases.get(key) ?? [];
    members.push(row); groupCases.set(key, members);
  }
  const groups = [...groupCases].map(([key, members]) => {
    const keys = new Set(members.map(c => c.key));
    const executions = execution.filter(a => a.target.origin === "catalog" && keys.has(trainingCatalogueKey(a.target)));
    return { key, target: members[0].target, group: members[0].group, execution: executionAnalytics(executions),
      recognition: recognitionPerformance(recognition.filter(a => keys.has(trainingCatalogueKey(a.target)))) };
  });
  const confusionCounts = new Map<string, { target: TrainingCatalogueIdentity; answerCaseId: string; count: number }>();
  for (const row of recognition.filter(a => !recognitionIsCorrect(a))) {
    const key = JSON.stringify([trainingCatalogueKey(row.target), row.answerCaseId]);
    const entry = confusionCounts.get(key) ?? { target: row.target, answerCaseId: row.answerCaseId, count: 0 };
    entry.count++; confusionCounts.set(key, entry);
  }
  const confusions = [...confusionCounts.values()].sort((a, b) => b.count - a.count ||
    trainingCatalogueKey(a.target).localeCompare(trainingCatalogueKey(b.target)) || a.answerCaseId.localeCompare(b.answerCaseId));
  return { execution: executionAnalytics(execution), recognition: recognitionPerformance(recognition), cases, groups, confusions,
    progression: trainingRunProgression(execution, recognition) };
}

export function trainingTrends(execution: readonly TrainingAttempt[], recognition: readonly TrainingRecognitionAttempt[], window: 25 | 50 | 100 | "all") {
  const limit = <T,>(rows: T[]) => window === "all" ? rows : rows.slice(-window);
  return { execution: limit(chronological(execution)).map(a => ({ id: a.id, createdAt: a.createdAt,
    elapsedMs: a.elapsedMs, caseTimeMs: a.caseTimeMs, effectiveDelta: a.preferredDelta ?? a.delta, matchedPreferred: a.matchedPreferred })),
    recognition: limit(chronological(recognition)).map(a => ({ id: a.id, createdAt: a.createdAt,
      correct: recognitionIsCorrect(a), correctResponseMs: recognitionIsCorrect(a) ? a.responseMs : null })) };
}
