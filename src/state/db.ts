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
  return solves.sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadAllSolves(): Promise<Solve[]> {
  return promisify(
    (await store("solves", "readonly")).getAll() as IDBRequest<Solve[]>,
  );
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
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await promisify(
    (await store("settings", "readwrite")).put(settings, "settings"),
  );
}
