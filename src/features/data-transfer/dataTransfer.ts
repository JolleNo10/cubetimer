import type { KPuzzle } from "cubing/kpuzzle";
import * as db from "../../infrastructure/persistence/db";
import * as sessionService from "../sessions/sessionService";
import { saveSolves } from "../history/solveHistory";
import * as drillPresets from "../training/trainingDrillPresets";
import * as algorithmPreferences from "../training/trainingAlgorithmPreferences";
import * as recognitionHistory from "../training/trainingRecognitionHistory";
import * as trainingHistory from "../training/trainingHistory";
import { assertSolveCsvHeader, formatSolveCsv, mergeSolveCsvSessions, solveCsvBatches, solveCsvLines } from "./solveCsv";
import type { Session, Solve, TrainingAlgorithmPreference } from "../../app/types";
import type { SessionContext, SessionContextTransition } from "../sessions/sessionService";

export type ImportResult = {
  sessions: number;
  solves: number;
  context: SessionContextTransition;
};

function collectSolveOwner(owners: Map<string, string>, solve: Solve): void {
  const owner = owners.get(solve.id);
  if (owner !== undefined && owner !== solve.sessionId) {
    throw new Error(`Import contains the same Solve ID "${solve.id}" under conflicting Sessions.`);
  }
  owners.set(solve.id, solve.sessionId);
}

/** All integrity checks finish before the first write, for JSON and every CSV batch. */
async function preflightImport(sessions: Session[], owners: Map<string, string>): Promise<void> {
  const existingSessions = await sessionService.assertImportSessionCompatibility(sessions, new Set(owners.values()));
  const allowedSessions = new Set([...existingSessions, ...sessions].map(session => session.id));
  for (const [id, sessionId] of owners) {
    if (!allowedSessions.has(sessionId)) {
      throw new Error(`Imported Solve "${id}" references a Session that does not exist: "${sessionId}".`);
    }
  }
  const existingOwners = await db.loadExistingSolveOwners(new Set(owners.keys()));
  for (const [id, sessionId] of existingOwners) {
    if (owners.get(id) !== sessionId) {
      throw new Error(`Imported Solve ID "${id}" already belongs to another Session: "${sessionId}".`);
    }
  }
}

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
  const incomingOwners = new Map<string, string>();
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
    const solve = db.migrateSolve({ ...rawSolve, moves: rawSolve.moves ?? [] });
    collectSolveOwner(incomingOwners, solve);
    importedSolves.push(solve);
  }
  await preflightImport(sessions, incomingOwners);

  for (const session of sessions) await db.saveSession(session);
  for (let offset = 0; offset < importedSolves.length; offset += 200) {
    await saveSolves(importedSolves.slice(offset, offset + 200));
  }
  for (const attempt of attempts) await trainingHistory.saveTrainingAttempt(attempt);
  for (const attempt of recognition) await recognitionHistory.saveTrainingRecognitionAttempt(attempt);
  for (const preset of presets) await drillPresets.saveTrainingDrillPreset(preset);
  for (const preference of preferences) await algorithmPreferences.saveTrainingAlgorithmPreference(preference);
  const context = await sessionService.reloadContext(kpuzzle, previous);
  return { sessions: sessions.length, solves: importedSolves.length, trainingAttempts: attempts.length, trainingRecognitionAttempts: recognition.length, trainingDrillPresets: presets.length, trainingAlgorithmPreferences: preferences.length, context };
}

/** Rows a CSV import could not read: how many, and the first few reasons. */
export type SkippedCsvRows = {
  count: number;
  sample: { line: number; reason: string }[];
};

const SKIPPED_SAMPLE_SIZE = 20;

/** Validate the whole file before writing, then yield to the browser between CSV batches. */
export async function importSolveCsv(
  kpuzzle: KPuzzle | undefined,
  previous: SessionContext,
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult & { skipped: SkippedCsvRows }> {
  const lines = solveCsvLines(text);
  assertSolveCsvHeader(lines[0]);

  let total = 0;
  const skipped: SkippedCsvRows = { count: 0, sample: [] };
  const incomingSessions = new Map<string, Session>();
  const incomingOwners = new Map<string, string>();
  for (const batch of solveCsvBatches(lines)) {
    mergeSolveCsvSessions(incomingSessions, batch.sessions);
    for (const solve of batch.solves) collectSolveOwner(incomingOwners, solve);
    total += batch.solves.length;
    skipped.count += batch.skipped.length;
    skipped.sample.push(...batch.skipped.slice(0, SKIPPED_SAMPLE_SIZE - skipped.sample.length));
  }
  await preflightImport([...incomingSessions.values()], incomingOwners);

  // Sessions as dated by the whole file, not by whichever batch met them first.
  for (const session of incomingSessions.values()) await db.saveSession(session);
  let done = 0;
  for (const batch of solveCsvBatches(lines)) {
    await saveSolves(batch.solves);
    done += batch.solves.length;
    onProgress?.(done, total);
    // Let the browser paint between batches.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const context = await sessionService.reloadContext(kpuzzle, previous);
  return { solves: done, sessions: incomingSessions.size, skipped, context };
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
