/**
 * Small IndexedDB wrapper for sessions, solves, settings and Training attempts.
 *
 * Solves carry their whole move stream, so a long session can run to a few megabytes —
 * more than `localStorage` will hold, hence IndexedDB.
 */
import { DEFAULT_EVENT_ID, EVENTS, type EventId } from "../../cube/scramble";
import { DEFAULT_SETTINGS, type Session, type Settings, type Solve, type TrainingAttempt, type TrainingAttemptTarget, type TrainingDrillPreset, type TrainingDrillPresetContext } from "../../app/types";
import { normaliseLastLayerTrainingSet } from "../../app/settings";
import { F2L_POSITIONS } from "../../cube/f2lCases";
import { findF2lTrainingCase, f2lTrainingCatalogue } from "../../cube/f2lTrainingCases";
import { lastLayerCaseIds } from "../../cube/lastLayerTraining";

const DB_NAME = "cubetimer";
const DB_VERSION = 3;

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
      if (!db.objectStoreNames.contains("trainingAttempts")) {
        db.createObjectStore("trainingAttempts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("trainingDrillPresets")) {
        db.createObjectStore("trainingDrillPresets", { keyPath: "id" });
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

type StoredSession = Omit<Session, "event"> & { event?: unknown };
type StoredSolve = Solve & { event?: unknown };

function isEventId(value: unknown): value is EventId {
  return EVENTS.some((event) => event.id === value);
}

export function migrateSession(session: StoredSession): Session {
  const { event: _legacyEvent, ...canonical } = session;
  return {
    ...canonical,
    event: isEventId(session.event) ? session.event : DEFAULT_EVENT_ID,
  };
}

/**
 * Bring a stored solve up to the current model.
 *
 * Analyses written before the solve model gained steps used a different shape, and
 * cannot be converted: those records never held turn counts or per-step moves. They
 * are dropped rather than half-read, so the solve simply shows no breakdown.
 */
export function migrateSolve(solve: StoredSolve): Solve {
  const { event: _legacyEvent, ...canonical } = solve;
  const analysis = canonical.analysis as { steps?: unknown } | null | undefined;
  if (analysis && !Array.isArray(analysis.steps)) {
    return { ...canonical, analysis: null, moves: canonical.moves ?? [] };
  }
  return { ...canonical, moves: canonical.moves ?? [] };
}

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const { event: _legacyEvent, ...withoutLegacyEvent } = (stored ?? {}) as Partial<Settings> & {
    event?: unknown;
  };
  const settings = { ...DEFAULT_SETTINGS, ...withoutLegacyEvent };
  return {
    ...settings,
    ollTrainingSet: normaliseLastLayerTrainingSet(settings.ollTrainingSet),
    pllTrainingSet: normaliseLastLayerTrainingSet(settings.pllTrainingSet),
    xCrossMaxMoves: [4, 5, 6].includes(settings.xCrossMaxMoves)
      ? settings.xCrossMaxMoves
      : DEFAULT_SETTINGS.xCrossMaxMoves,
    whiteCrossMoves: [1, 2, 3, 4, 5, 6, 7].includes(settings.whiteCrossMoves)
      ? settings.whiteCrossMoves
      : DEFAULT_SETTINGS.whiteCrossMoves,
  };
}

export async function loadSessions(): Promise<Session[]> {
  const sessions = await promisify(
    (await store("sessions", "readonly")).getAll() as IDBRequest<Session[]>,
  );
  return sessions.map(migrateSession).sort((a, b) => a.createdAt - b.createdAt);
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
    return mergeSettings(stored);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await promisify(
    (await store("settings", "readwrite")).put(settings, "settings"),
  );
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** Current shape only. Rebuild the contract explicitly; never import extra fields. */
export function normalizeTrainingAttempt(value: unknown): TrainingAttempt | null {
  if (!record(value) || !text(value.id) || !nonnegative(value.createdAt) ||
      (value.mode !== "setup" && value.mode !== "virtual") || !record(value.target) ||
      !Array.isArray(value.moves) || !value.moves.every(text) ||
      !integer(value.stm) || value.stm < 0 || !nonnegative(value.elapsedMs) ||
      !(value.recommendedStm === null || integer(value.recommendedStm) && value.recommendedStm >= 0) ||
      !(value.matchedReferenceRank === null || integer(value.matchedReferenceRank) && value.matchedReferenceRank > 0) ||
      !(value.delta === null || integer(value.delta))) return null;
  const activity = value.activity === undefined ? "single" : value.activity;
  const caseTimeMs = value.caseTimeMs === undefined ? null : value.caseTimeMs;
  if ((activity !== "single" && activity !== "drill") ||
      !(caseTimeMs === null || nonnegative(caseTimeMs)) ||
      (activity === "single" && caseTimeMs !== null) ||
      (activity === "drill" && (value.mode !== "virtual" || caseTimeMs === null || value.target.origin !== "catalog"))) return null;
  const t = value.target;
  let target: TrainingAttemptTarget;
  if (t.family === "f2l") {
    const position = F2L_POSITIONS.find(p => p === t.position);
    if (!position) return null;
    if (t.origin === "catalog") {
      if ((t.library !== "basic" && t.library !== "advanced") || !text(t.caseName) ||
          !findF2lTrainingCase(t.library, t.caseName)) return null;
      target = { family: "f2l", origin: "catalog", library: t.library, caseName: t.caseName, position };
    } else if (t.origin === "solve-step" && text(t.solveId) && text(t.stepName) &&
        (t.recognizedCaseName === undefined || text(t.recognizedCaseName))) {
      target = { family: "f2l", origin: "solve-step", solveId: t.solveId, stepName: t.stepName, position,
        ...(t.recognizedCaseName === undefined ? {} : { recognizedCaseName: t.recognizedCaseName }) };
    } else return null;
  } else if (t.family === "oll" || t.family === "pll") {
    if ((t.trainingSet !== "full" && t.trainingSet !== "2look") || !text(t.caseId) ||
        !lastLayerCaseIds(t.family, t.trainingSet).includes(t.caseId) ||
        (t.auf !== 0 && t.auf !== 1 && t.auf !== 2 && t.auf !== 3)) return null;
    if (t.origin === "catalog") {
      target = { family: t.family, origin: "catalog", trainingSet: t.trainingSet, caseId: t.caseId, auf: t.auf };
    } else if (t.origin === "solve-step" && t.trainingSet === "full" && text(t.solveId) &&
        t.stepName === t.family.toUpperCase()) {
      target = { family: t.family, origin: "solve-step", trainingSet: "full", caseId: t.caseId, auf: t.auf,
        solveId: t.solveId, stepName: t.family === "oll" ? "OLL" : "PLL" };
    } else return null;
  } else return null;
  return {
    id: value.id, createdAt: value.createdAt, mode: value.mode, activity, caseTimeMs, target, moves: [...value.moves] as string[],
    stm: value.stm, elapsedMs: value.elapsedMs, recommendedStm: value.recommendedStm,
    matchedReferenceRank: value.matchedReferenceRank, delta: value.delta,
  };
}

export function compareTrainingAttempts(a: TrainingAttempt, b: TrainingAttempt): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function loadTrainingAttempts(): Promise<TrainingAttempt[]> {
  const rows = await promisify((await store("trainingAttempts", "readonly")).getAll() as IDBRequest<unknown[]>);
  return rows.map(normalizeTrainingAttempt).filter((row): row is TrainingAttempt => row !== null).sort(compareTrainingAttempts);
}

export async function saveTrainingAttempt(attempt: TrainingAttempt): Promise<void> {
  const db = await openDatabase();
  // Wait for transaction commit, so an abort after a successful put still reports failure.
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("trainingAttempts", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Training history write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Training history write failed."));
    transaction.objectStore("trainingAttempts").put(attempt);
  });
}

/** Strict current configuration shape. Unknown cases invalidate the entire preset. */
export function normalizeTrainingDrillPreset(value: unknown): TrainingDrillPreset | null {
  if (!record(value) || !text(value.id) || !text(value.name) || value.name.trim().length > 80 ||
      !nonnegative(value.createdAt) || !nonnegative(value.updatedAt) || value.updatedAt < value.createdAt ||
      !["sequence", "random", "weighted"].includes(value.strategy as string) ||
      !record(value.context) || !Array.isArray(value.caseIds) || !value.caseIds.length || !value.caseIds.every(text)) return null;
  const c = value.context;
  let context: TrainingDrillPresetContext;
  let catalogue: readonly string[];
  if (c.family === "f2l") {
    const position = F2L_POSITIONS.find(p => p === c.position);
    if (!position || (c.library !== "basic" && c.library !== "advanced") || "trainingSet" in c) return null;
    context = { family: "f2l", library: c.library, position };
    catalogue = f2lTrainingCatalogue(c.library).cases.map(c => c.name);
  } else if (c.family === "oll" || c.family === "pll") {
    if ((c.trainingSet !== "full" && c.trainingSet !== "2look") || "library" in c || "position" in c) return null;
    context = { family: c.family, trainingSet: c.trainingSet };
    catalogue = lastLayerCaseIds(c.family, c.trainingSet);
  } else return null;
  if (!value.caseIds.every(id => catalogue.includes(id))) return null;
  return {
    id: value.id, name: value.name.trim(), createdAt: value.createdAt, updatedAt: value.updatedAt,
    context, strategy: value.strategy as TrainingDrillPreset["strategy"],
    caseIds: catalogue.filter(id => (value.caseIds as string[]).includes(id)),
  };
}

export function compareTrainingDrillPresets(a: TrainingDrillPreset, b: TrainingDrillPreset): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function loadTrainingDrillPresets(): Promise<TrainingDrillPreset[]> {
  const rows = await promisify((await store("trainingDrillPresets", "readonly")).getAll() as IDBRequest<unknown[]>);
  return rows.map(normalizeTrainingDrillPreset).filter((row): row is TrainingDrillPreset => row !== null).sort(compareTrainingDrillPresets);
}

export async function saveTrainingDrillPreset(preset: TrainingDrillPreset): Promise<void> {
  const normalized = normalizeTrainingDrillPreset(preset);
  if (!normalized) throw new Error("Invalid saved Drill configuration.");
  await writeTrainingDrillPreset(store => store.put(normalized));
}

export async function deleteTrainingDrillPreset(id: string): Promise<void> {
  await writeTrainingDrillPreset(store => store.delete(id));
}

async function writeTrainingDrillPreset(write: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("trainingDrillPresets", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Saved Drill write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Saved Drill write failed."));
    write(transaction.objectStore("trainingDrillPresets"));
  });
}
