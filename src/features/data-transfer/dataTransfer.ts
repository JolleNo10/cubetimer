import type { KPuzzle } from "cubing/kpuzzle";
import * as db from "../../infrastructure/persistence/db";
import * as sessionService from "../sessions/sessionService";
import { saveSolve } from "../history/solveHistory";
import { countSolveCsvRows, solveCsvBatches, formatSolveCsv } from "./solveCsv";
import type { Session, Solve } from "../../app/types";
import type { SessionContext, SessionContextTransition } from "../sessions/sessionService";

export type ImportResult = {
  sessions: number;
  solves: number;
  context: SessionContextTransition;
};

export async function exportData(): Promise<string> {
  const [sessions, solves] = await Promise.all([
    db.loadSessions(),
    db.loadAllSolves(),
  ]);
  return JSON.stringify(
    { format: "cubetimer", version: 2, exportedAt: Date.now(), sessions, solves },
    null,
    2,
  );
}

/** ID-stable JSON merge, normalized through the storage migrations. */
export async function importData(
  kpuzzle: KPuzzle | undefined,
  previous: SessionContext,
  json: string,
): Promise<ImportResult> {
  const data = JSON.parse(json) as {
    sessions?: Array<Omit<Session, "event"> & { event?: unknown }>;
    solves?: Array<Solve & { event?: unknown }>;
  };
  if (!Array.isArray(data.sessions) || !Array.isArray(data.solves)) {
    throw new Error("This does not look like a cubetimer export.");
  }

  const sessions = data.sessions
    .filter((rawSession) => rawSession && typeof rawSession === "object")
    .map((rawSession) => db.migrateSession(rawSession))
    .filter((session) => Boolean(session.id && session.name));
  const importedSolves: Solve[] = [];
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
  const context = await sessionService.reloadContext(kpuzzle, previous);
  return { sessions: sessions.length, solves: importedSolves.length, context };
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
