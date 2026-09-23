/**
 * Small IndexedDB wrapper for sessions, solves and settings.
 *
 * Solves carry their whole move stream, so a long session can run to a few megabytes —
 * more than `localStorage` will hold, hence IndexedDB.
 */
import { DEFAULT_SETTINGS, type Session, type Settings, type Solve } from "./types";

const DB_NAME = "cubetimer";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("solves")) {
        const store = db.createObjectStore("solves", { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(
  name: string,
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

/**
 * Bring a stored solve up to the current model.
 *
 * Analyses written before the solve model gained steps used a different shape, and
 * cannot be converted: those records never held turn counts or per-step moves. They
 * are dropped rather than half-read, so the solve simply shows no breakdown.
 */
export function migrateSolve(solve: Solve): Solve {
  const analysis = solve.analysis as { steps?: unknown } | null | undefined;
  if (analysis && !Array.isArray(analysis.steps)) {
    return { ...solve, analysis: null };
  }
  return { ...solve, moves: solve.moves ?? [] };
}

export async function loadSessions(): Promise<Session[]> {
  const sessions = await promisify(
    (await store("sessions", "readonly")).getAll() as IDBRequest<Session[]>,
  );
  return sessions.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveSession(session: Session): Promise<void> {
  await promisify((await store("sessions", "readwrite")).put(session));
}

export async function deleteSession(id: string): Promise<void> {
  await promisify((await store("sessions", "readwrite")).delete(id));
  for (const solve of await loadSolves(id)) {
    await deleteSolve(solve.id);
  }
}

export async function loadSolves(sessionId: string): Promise<Solve[]> {
  const index = (await store("solves", "readonly")).index("sessionId");
  const solves = await promisify(
    index.getAll(sessionId) as IDBRequest<Solve[]>,
  );
  return solves.map(migrateSolve).sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadAllSolves(): Promise<Solve[]> {
  const solves = await promisify(
    (await store("solves", "readonly")).getAll() as IDBRequest<Solve[]>,
  );
  return solves.map(migrateSolve);
}

export async function saveSolve(solve: Solve): Promise<void> {
  await promisify((await store("solves", "readwrite")).put(solve));
}

export async function deleteSolve(id: string): Promise<void> {
  await promisify((await store("solves", "readwrite")).delete(id));
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await promisify(
      (await store("settings", "readonly")).get("settings") as IDBRequest<
        Partial<Settings> | undefined
      >,
    );
    const settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    // Settings are persisted data, so keep an older or hand-edited value from
    // leaking past the typed boundary if the allowed choices ever change.
    if (![4, 5, 6].includes(settings.xCrossMaxMoves)) {
      return { ...settings, xCrossMaxMoves: DEFAULT_SETTINGS.xCrossMaxMoves };
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await promisify(
    (await store("settings", "readwrite")).put(settings, "settings"),
  );
}
