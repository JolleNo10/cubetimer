/**
 * Small IndexedDB wrapper for sessions, solves, settings and Training attempts.
 *
 * Solves carry their whole move stream, so a long session can run to a few megabytes —
 * more than `localStorage` will hold, hence IndexedDB.
 */
import { FACES, type Face } from "../../cube/moves";
import { DATE_FORMATS, TIME_FORMATS, normaliseTimeZone } from "../../shared/time";
import { DEFAULT_EVENT_ID, EVENTS, type EventId } from "../../cube/scramble";
import { COMPARE_SCOPES, DEFAULT_SETTINGS, RESULT_CHARTS, RESULT_SCATTERS, type CompareScope, type Session, type Settings, type Solve, type TrainingAttempt, type TrainingAttemptTarget, type TrainingDrillPreset, type TrainingDrillPresetContext, type TrainingAlgorithmPreference, type TrainingRecognitionAttempt } from "../../app/types";
import { normalizeTrainingCatalogueIdentity, trainingCatalogueCaseIds, trainingCatalogueKey } from "../../app/trainingCatalogue";
import { normaliseLastLayerTrainingSet, normaliseSolveThreshold } from "../../app/settings";
import { F2L_POSITIONS } from "../../cube/f2lCases";
import { findF2lTrainingCase, f2lTrainingCatalogue } from "../../cube/f2lTrainingCases";
import { lastLayerCaseIds } from "../../cube/lastLayerTraining";

const DB_NAME = "cubetimer";
const DB_VERSION = 5;

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
      if (!db.objectStoreNames.contains("trainingRecognitionAttempts")) {
        db.createObjectStore("trainingRecognitionAttempts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("trainingAlgorithmPreferences")) {
        db.createObjectStore("trainingAlgorithmPreferences", { keyPath: "key" });
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

type StoredSession = Omit<Session, "event" | "compareScope"> & { event?: unknown; compareScope?: unknown };
type StoredSolve = Solve & { event?: unknown };

function isEventId(value: unknown): value is EventId {
  return EVENTS.some((event) => event.id === value);
}

export function migrateSession(session: StoredSession): Session {
  const { event: _legacyEvent, ...canonical } = session;
  return {
    ...canonical,
    event: isEventId(session.event) ? session.event : DEFAULT_EVENT_ID,
    compareScope: COMPARE_SCOPES.includes(session.compareScope as CompareScope) ? session.compareScope as CompareScope : "session",
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
  const { event: _legacyEvent, statisticsOutlier: _derivedOutlier, ...canonical } = solve;
  canonical.solveStartBottomFace = FACES.includes(solve.solveStartBottomFace as Face) ? solve.solveStartBottomFace : undefined;
  canonical.cfopAnalysisExcluded = solve.cfopAnalysisExcluded === true ? true : undefined;
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
    ...normaliseSolveThreshold(settings),
    timeZone: normaliseTimeZone(settings.timeZone),
    dateFormat: DATE_FORMATS.includes(settings.dateFormat) ? settings.dateFormat : "locale",
    timeFormat: TIME_FORMATS.includes(settings.timeFormat) ? settings.timeFormat : "locale",
    ollTrainingSet: normaliseLastLayerTrainingSet(settings.ollTrainingSet),
    pllTrainingSet: normaliseLastLayerTrainingSet(settings.pllTrainingSet),
    xCrossMaxMoves: [4, 5, 6].includes(settings.xCrossMaxMoves)
      ? settings.xCrossMaxMoves
      : DEFAULT_SETTINGS.xCrossMaxMoves,
    whiteCrossMoves: [1, 2, 3, 4, 5, 6, 7].includes(settings.whiteCrossMoves)
      ? settings.whiteCrossMoves
      : DEFAULT_SETTINGS.whiteCrossMoves,
    resultChart: RESULT_CHARTS.includes(settings.resultChart) ? settings.resultChart : DEFAULT_SETTINGS.resultChart,
    resultScatter: RESULT_SCATTERS.includes(settings.resultScatter) ? settings.resultScatter : DEFAULT_SETTINGS.resultScatter,
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
  const { statisticsOutlier: _derivedOutlier, ...rawSolve } = solve;
  await promisify((await store("solves", "readwrite")).put(rawSolve));
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
  const drillRunId = value.drillRunId === undefined ? null : value.drillRunId;
  const drillRound = value.drillRound === undefined ? null : value.drillRound;
  if (!(drillRunId === null && drillRound === null) &&
      !(activity === "drill" && text(drillRunId) && integer(drillRound) && drillRound > 0)) return null;
  const preferredStm = value.preferredStm === undefined ? null : value.preferredStm;
  const matchedPreferred = value.matchedPreferred === undefined ? null : value.matchedPreferred;
  const preferredDelta = value.preferredDelta === undefined ? null : value.preferredDelta;
  if (!(preferredStm === null && matchedPreferred === null && preferredDelta === null) &&
      !(nonnegative(preferredStm) && typeof matchedPreferred === "boolean" && typeof preferredDelta === "number" && Number.isFinite(preferredDelta))) return null;
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
    id: value.id, createdAt: value.createdAt, mode: value.mode, activity, caseTimeMs, drillRunId, drillRound, target, moves: [...value.moves] as string[],
    stm: value.stm, elapsedMs: value.elapsedMs, recommendedStm: value.recommendedStm,
    matchedReferenceRank: value.matchedReferenceRank, delta: value.delta, preferredStm, matchedPreferred, preferredDelta,
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
  const task = value.task === undefined ? "execution" : value.task;
  if (task !== "execution" && task !== "recognition") return null;
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
  const caseIds = catalogue.filter(id => (value.caseIds as string[]).includes(id));
  if (task === "recognition" && caseIds.length < 2) return null;
  return { id: value.id, name: value.name.trim(), createdAt: value.createdAt, updatedAt: value.updatedAt,
    context, task, strategy: value.strategy as TrainingDrillPreset["strategy"], caseIds };

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
  await writeTrainingRecord("trainingDrillPresets", store => store.put(normalized));
}

export async function deleteTrainingDrillPreset(id: string): Promise<void> {
  await writeTrainingRecord("trainingDrillPresets", store => store.delete(id));
}

async function writeTrainingRecord(name: "trainingDrillPresets" | "trainingAlgorithmPreferences" | "trainingRecognitionAttempts", write: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(name, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Training record write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Training record write failed."));
    write(transaction.objectStore(name));
  });
}

/** Record shape/catalogue normalization only; semantic validation belongs to Training. */
export function normalizeTrainingAlgorithmPreference(value: unknown): TrainingAlgorithmPreference | null {
  if (!record(value)) return null;
  const target = normalizeTrainingCatalogueIdentity(value.target);
  if (!target || value.key !== trainingCatalogueKey(target) || !text(value.algorithm) || value.algorithm.length > 1000 ||
      (value.source !== "catalog" && value.source !== "custom") ||
      !(value.note === null || typeof value.note === "string" && value.note.trim().length <= 240) ||
      !nonnegative(value.createdAt) || !nonnegative(value.updatedAt) || value.updatedAt < value.createdAt) return null;
  return { key: value.key as string, target, algorithm: value.algorithm.trim(), source: value.source,
    note: typeof value.note === "string" ? value.note.trim() || null : null, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function compareTrainingAlgorithmPreferences(a: TrainingAlgorithmPreference, b: TrainingAlgorithmPreference): number {
  return b.updatedAt - a.updatedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export async function loadTrainingAlgorithmPreferences(): Promise<TrainingAlgorithmPreference[]> {
  const rows = await promisify((await store("trainingAlgorithmPreferences", "readonly")).getAll() as IDBRequest<unknown[]>);
  return rows.map(normalizeTrainingAlgorithmPreference).filter((row): row is TrainingAlgorithmPreference => row !== null).sort(compareTrainingAlgorithmPreferences);
}

export async function saveTrainingAlgorithmPreference(preference: TrainingAlgorithmPreference): Promise<void> {
  const normalized = normalizeTrainingAlgorithmPreference(preference);
  if (!normalized) throw new Error("Invalid personal Training algorithm record.");
  await writeTrainingRecord("trainingAlgorithmPreferences", store => store.put(normalized));
}

export async function deleteTrainingAlgorithmPreference(key: string): Promise<void> {
  await writeTrainingRecord("trainingAlgorithmPreferences", store => store.delete(key));
}


export function normalizeTrainingRecognitionAttempt(value: unknown): TrainingRecognitionAttempt | null {
  if (!record(value) || !text(value.id) || !nonnegative(value.createdAt) || !text(value.drillRunId) ||
      !integer(value.drillRound) || value.drillRound <= 0 || !nonnegative(value.responseMs)) return null;
  const target = normalizeTrainingCatalogueIdentity(value.target);
  if (!target || typeof value.answerCaseId !== "string" || !trainingCatalogueCaseIds(target).includes(value.answerCaseId)) return null;
  return { id: value.id, createdAt: value.createdAt, drillRunId: value.drillRunId, drillRound: value.drillRound,
    target, answerCaseId: value.answerCaseId, responseMs: value.responseMs };
}

export async function loadTrainingRecognitionAttempts(): Promise<TrainingRecognitionAttempt[]> {
  const rows = await promisify((await store("trainingRecognitionAttempts", "readonly")).getAll() as IDBRequest<unknown[]>);
  return rows.map(normalizeTrainingRecognitionAttempt).filter((row): row is TrainingRecognitionAttempt => row !== null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function saveTrainingRecognitionAttempt(attempt: TrainingRecognitionAttempt): Promise<void> {
  const normalized = normalizeTrainingRecognitionAttempt(attempt);
  if (!normalized) throw new Error("Invalid Recognition history record.");
  await writeTrainingRecord("trainingRecognitionAttempts", store => store.put(normalized));
}
