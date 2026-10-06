import type { KPuzzle } from "cubing/kpuzzle";
import { DEFAULT_EVENT_ID, type EventId } from "../../cube/scramble";
import * as db from "../../infrastructure/persistence/db";
import { loadSessionHistory } from "../history/solveHistory";
import type { CompareScope, Session, Solve } from "../../app/types";

export type SessionContext = {
  sessions: Session[];
  sessionId: string;
  solves: Solve[];
};

export type SessionContextTransition = SessionContext & { eventChanged: boolean };

export function currentSession(context: SessionContext): Session | undefined {
  return context.sessions.find((session) => session.id === context.sessionId);
}

function newSession(name: string, event: EventId): Session {
  return { id: crypto.randomUUID(), name, event, createdAt: Date.now() };
}

export async function loadInitialContext(kpuzzle: KPuzzle): Promise<SessionContext> {
  let sessions = await db.loadSessions();
  if (sessions.length === 0) {
    const session = newSession("Session 1", DEFAULT_EVENT_ID);
    await db.saveSession(session);
    sessions = [session];
  }
  const sessionId = sessions[sessions.length - 1].id;
  return { sessions, sessionId, solves: await loadSessionHistory(kpuzzle, sessionId) };
}

export async function selectSession(
  kpuzzle: KPuzzle | undefined,
  context: SessionContext,
  sessionId: string,
): Promise<SessionContextTransition | undefined> {
  const target = context.sessions.find((session) => session.id === sessionId);
  if (!target) return undefined;
  return {
    sessions: context.sessions,
    sessionId,
    solves: await loadSessionHistory(kpuzzle, sessionId),
    eventChanged: currentSession(context)?.event !== target.event,
  };
}

export async function createSession(
  kpuzzle: KPuzzle | undefined,
  context: SessionContext,
  name: string,
  event: EventId = currentSession(context)?.event ?? DEFAULT_EVENT_ID,
): Promise<SessionContextTransition> {
  const session = newSession(name, event);
  await db.saveSession(session);
  return (await selectSession(kpuzzle, {
    ...context, sessions: [...context.sessions, session],
  }, session.id))!;
}

export async function changeEvent(
  kpuzzle: KPuzzle | undefined,
  context: SessionContext,
  event: EventId,
): Promise<SessionContextTransition | undefined> {
  const session = currentSession(context);
  if (!session || session.event === event) return undefined;
  if (context.solves.some((solve) => solve.sessionId === session.id)) {
    return createSession(kpuzzle, context, `Session ${context.sessions.length + 1}`, event);
  }
  const updated = { ...session, event };
  await db.saveSession(updated);
  return {
    ...context,
    sessions: context.sessions.map((candidate) => candidate.id === updated.id ? updated : candidate),
    eventChanged: true,
  };
}

export async function renameSession(sessions: Session[], id: string, name: string): Promise<Session | undefined> {
  const session = sessions.find((candidate) => candidate.id === id);
  if (!session) return undefined;
  const updated = { ...session, name };
  await db.saveSession(updated);
  return updated;
}

export async function setSessionCompareScope(sessions: Session[], id: string, compareScope: CompareScope): Promise<Session | undefined> {
  const session = sessions.find((candidate) => candidate.id === id);
  if (!session) return undefined;
  const updated = { ...session, compareScope };
  await db.saveSession(updated);
  return updated;
}

export async function deleteSession(
  kpuzzle: KPuzzle | undefined,
  context: SessionContext,
  id: string,
): Promise<SessionContextTransition | undefined> {
  if (context.sessions.length <= 1) return undefined;
  await db.deleteSession(id);
  const sessions = context.sessions.filter((session) => session.id !== id);
  if (context.sessionId !== id) return { ...context, sessions, eventChanged: false };
  const target = sessions[sessions.length - 1];
  return {
    sessions,
    sessionId: target.id,
    solves: await loadSessionHistory(kpuzzle, target.id),
    eventChanged: currentSession(context)?.event !== target.event,
  };
}

/** Retain the selected identity after a merge; otherwise use the newest Session. */
export async function reloadContext(
  kpuzzle: KPuzzle | undefined,
  previous: SessionContext,
): Promise<SessionContextTransition> {
  const sessions = await db.loadSessions();
  const before = currentSession(previous);
  const target = sessions.find((session) => session.id === previous.sessionId) ?? sessions.at(-1);
  return {
    sessions,
    sessionId: target?.id ?? "",
    solves: target ? await loadSessionHistory(kpuzzle, target.id) : [],
    eventChanged: before !== undefined && target !== undefined && before.event !== target.event,
  };
}

/** Validate the entire merge before any records are overwritten. */
export async function assertImportSessionCompatibility(
  incomingSessions: Session[],
  incomingSolveSessionIds: Set<string>,
): Promise<void> {
  const [existingSessions, existingSolves] = await Promise.all([
    db.loadSessions(), db.loadAllSolves(),
  ]);
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));
  const existingHistory = new Set(existingSolves.map((solve) => solve.sessionId));
  const incomingById = new Map<string, Session>();
  for (const session of incomingSessions) {
    const previous = incomingById.get(session.id);
    if (previous && previous.event !== session.event) {
      throw new Error(
        `Cannot merge session "${session.name}": the import contains conflicting events for this session.`,
      );
    }
    incomingById.set(session.id, session);
  }
  for (const session of incomingById.values()) {
    const existing = existingById.get(session.id);
    if (existing && existing.event !== session.event &&
      (existingHistory.has(session.id) || incomingSolveSessionIds.has(session.id))) {
      throw new Error(
        `Cannot merge session "${session.name}": the existing and imported sessions use different events while solve history exists.`,
      );
    }
  }
}
