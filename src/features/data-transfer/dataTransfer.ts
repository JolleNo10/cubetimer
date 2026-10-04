import type { KPuzzle } from "cubing/kpuzzle";
import * as db from "../../infrastructure/persistence/db";
import * as sessionService from "../sessions/sessionService";
import { saveSolve } from "../history/solveHistory";
import * as drillPresets from "../training/trainingDrillPresets";
import * as algorithmPreferences from "../training/trainingAlgorithmPreferences";
import * as recognitionHistory from "../training/trainingRecognitionHistory";
import * as trainingHistory from "../training/trainingHistory";
import { countSolveCsvRows, solveCsvBatches, formatSolveCsv } from "./solveCsv";
import type { Session, Solve, TrainingAlgorithmPreference } from "../../app/types";
import type { SessionContext, SessionContextTransition } from "../sessions/sessionService";

export type ImportResult = {
  sessions: number;
  solves: number;
  context: SessionContextTransition;
};

export async function exportData(): Promise<string> {
  const [sessions, solves, trainingAttempts, trainingDrillPresets, trainingAlgorithmPreferences, trainingRecognitionAttempts] = await Promise.all([
    db.loadSessions(),
    db.loadAllSolves(),
    trainingHistory.loadTrainingAttempts(),
    drillPresets.loadTrainingDrillPresets(),
    algorithmPreferences.loadTrainingAlgorithmPreferences(),
    recognitionHistory.loadTrainingRecognitionAttempts(),
  ]);
  return JSON.stringify(
    { format: "cubetimer", version: 7, exportedAt: Date.now(), sessions, solves, trainingAttempts, trainingDrillPresets, trainingAlgorithmPreferences, trainingRecognitionAttempts },
    null,
    2,
  );
}

/** ID-stable JSON merge, normalized through the storage migrations. */
export async function importData(
  kpuzzle: KPuzzle | undefined,
  previous: SessionContext,
  json: string,
): Promise<ImportResult & { trainingAttempts: number; trainingRecognitionAttempts: number; trainingDrillPresets: number; trainingAlgorithmPreferences: number }> {
  const data = JSON.parse(json) as {
    sessions?: Array<Omit<Session, "event"> & { event?: unknown }>;
    solves?: Array<Solve & { event?: unknown }>;
    trainingAttempts?: unknown[];
    trainingRecognitionAttempts?: unknown[];
    trainingDrillPresets?: unknown[];
    trainingAlgorithmPreferences?: unknown[];
  };
  if (!Array.isArray(data.sessions) || !Array.isArray(data.solves)) {
    throw new Error("This does not look like a cubetimer export.");
  }

  const sessions = data.sessions
    .filter((rawSession) => rawSession && typeof rawSession === "object")
    .map((rawSession) => db.migrateSession(rawSession))
    .filter((session) => Boolean(session.id && session.name));
  const importedSolves: Solve[] = [];
  const attempts = (Array.isArray(data.trainingAttempts) ? data.trainingAttempts : [])
    .map(db.normalizeTrainingAttempt).filter(attempt => attempt !== null);
  const recognition = (Array.isArray(data.trainingRecognitionAttempts) ? data.trainingRecognitionAttempts : [])
    .map(db.normalizeTrainingRecognitionAttempt).filter(attempt => attempt !== null);
  const presets = (Array.isArray(data.trainingDrillPresets) ? data.trainingDrillPresets : [])
    .map(db.normalizeTrainingDrillPreset).filter(preset => preset !== null);
  const preferences: TrainingAlgorithmPreference[] = [];
  for (const raw of Array.isArray(data.trainingAlgorithmPreferences) ? data.trainingAlgorithmPreferences : []) {
    const preference = db.normalizeTrainingAlgorithmPreference(raw);
    if (!preference || !kpuzzle) continue;
    try {
      const algorithm = algorithmPreferences.validateTrainingAlgorithm(kpuzzle, preference.target, preference.algorithm);
      preferences.push({ ...preference, algorithm });
    } catch { /* Imported user algorithms must satisfy the same save-time semantics. */ }
  }
  for (const rawSolve of data.solves) {
    if (!rawSolve?.id || !rawSolve.sessionId || typeof rawSolve.rawMs !== "number") continue;
    importedSolves.push(
      db.migrateSolve({ ...rawSolve, moves: rawSolve.moves ?? [] }),
    );
  }
  await sessionService.assertImportSessionCompatibility(
    sessions,
    new Set(importedSolves.map((solve) => solve.sessionId)),
  );

  for (const session of sessions) await db.saveSession(session);
  for (const solve of importedSolves) await saveSolve(solve);
  for (const attempt of attempts) await trainingHistory.saveTrainingAttempt(attempt);
  for (const attempt of recognition) await recognitionHistory.saveTrainingRecognitionAttempt(attempt);
  for (const preset of presets) await drillPresets.saveTrainingDrillPreset(preset);
  for (const preference of preferences) await algorithmPreferences.saveTrainingAlgorithmPreference(preference);
  const context = await sessionService.reloadContext(kpuzzle, previous);
  return { sessions: sessions.length, solves: importedSolves.length, trainingAttempts: attempts.length, trainingRecognitionAttempts: recognition.length, trainingDrillPresets: presets.length, trainingAlgorithmPreferences: preferences.length, context };
}

/** Validate before writing, then yield to the browser between CSV batches. */
export async function importSolveCsv(
  kpuzzle: KPuzzle | undefined,
  previous: SessionContext,
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const total = countSolveCsvRows(text);
  const incomingSessions = new Map<string, Session>();
  const incomingSolveSessionIds = new Set<string>();
  for (const batch of solveCsvBatches(text)) {
    for (const session of batch.sessions) incomingSessions.set(session.id, session);
    for (const solve of batch.solves) incomingSolveSessionIds.add(solve.sessionId);
  }
  await sessionService.assertImportSessionCompatibility(
    [...incomingSessions.values()],
    incomingSolveSessionIds,
  );

  const sessionIds = new Set<string>();
  let done = 0;
  for (const batch of solveCsvBatches(text)) {
    for (const session of batch.sessions) {
      if (sessionIds.has(session.id)) continue;
      sessionIds.add(session.id);
      await db.saveSession(session);
    }
    for (const solve of batch.solves) await saveSolve(solve);
    done += batch.solves.length;
    onProgress?.(done, total);
    // Let the browser paint between batches.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const context = await sessionService.reloadContext(kpuzzle, previous);
  return { solves: done, sessions: sessionIds.size, context };
}

export async function exportSolveCsv(
  scope: "session" | "all",
  sessions: Session[],
  solves: Solve[],
): Promise<string> {
  const names = new Map(sessions.map((session) => [session.id, session.name]));
  const rows = scope === "all" ? await db.loadAllSolves() : solves;
  const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  return formatSolveCsv(ordered, names);
}
