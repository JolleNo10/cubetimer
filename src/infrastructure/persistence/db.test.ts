import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EVENT_ID } from "../../cube/scramble";
import { mergeSettings, migrateSession, migrateSolve, normalizeTrainingAttempt, normalizeTrainingDrillPreset } from "./db";
import type { Solve, TrainingAttempt, TrainingDrillPreset } from "../../app/types";

import { f2lTrainingCatalogue } from "../../cube/f2lTrainingCases";
import { lastLayerCaseIds } from "../../cube/lastLayerTraining";

const base = {
  id: "1",
  sessionId: "s",
  createdAt: 0,
  rawMs: 1000,
  penalty: "none",
  scramble: "R U",
  event: "333",
  source: "smartcube",
  moves: [{ move: "R", t: 10 }],
} as unknown as Solve;

describe("migrateSolve", () => {
  it("drops the legacy event while preserving canonical solve facts", () => {
    const migrated = migrateSolve(base);
    expect(migrated).not.toHaveProperty("event");
    expect(migrated.moves).toEqual(base.moves);
  });

  it("drops an analysis written before the solve model had steps", () => {
    const legacy = {
      ...base,
      // The old shape: phases, with none of the per-step detail the UI now reads.
      analysis: { crossFace: "D", phases: [{ name: "Cross", durationMs: 500 }] },
    } as unknown as Solve;
    expect(migrateSolve(legacy).analysis).toBeNull();
  });

  it("leaves a current analysis alone", () => {
    const current = { ...base, analysis: { steps: [{ name: "Cross" }] } } as unknown as Solve;
    expect(migrateSolve(current).analysis).toEqual({ steps: [{ name: "Cross" }] });
  });

  it("leaves solves with no analysis alone", () => {
    expect(migrateSolve(base).analysis).toBeUndefined();
    expect(migrateSolve({ ...base, analysis: null }).analysis).toBeNull();
  });

  it("gives a solve with no move stream an empty one", () => {
    const noMoves = { ...base, moves: undefined } as unknown as Solve;
    expect(migrateSolve(noMoves).moves).toEqual([]);
  });
});

describe("mergeSettings", () => {
  it.each([undefined, {}])("defaults old last-layer settings to Full/Full", (stored) => {
    expect(mergeSettings(stored)).toMatchObject({ ollTrainingSet: "full", pllTrainingSet: "full" });
  });

  it.each(["full", "2look"] as const)("preserves valid %s settings independently", (value) => {
    expect(mergeSettings({ ollTrainingSet: value })).toMatchObject({ ollTrainingSet: value, pllTrainingSet: "full" });
    expect(mergeSettings({ pllTrainingSet: value })).toMatchObject({ ollTrainingSet: "full", pllTrainingSet: value });
    expect(mergeSettings({ ollTrainingSet: value, pllTrainingSet: value })).toMatchObject({ ollTrainingSet: value, pllTrainingSet: value });
  });

  it.each([undefined, null, "2-look", "", 2, true, {}, []])("rejects malformed persisted Training sets: %s", (value) => {
    expect(mergeSettings({ ollTrainingSet: value, pllTrainingSet: value } as never)).toMatchObject({ ollTrainingSet: "full", pllTrainingSet: "full" });
  });

  it("discards a legacy active event", () => {
    const settings = mergeSettings({ event: "222" } as never);
    expect(settings).not.toHaveProperty("event");
  });

  it("uses the default white-cross length for older settings", () => {
    expect(mergeSettings({}).whiteCrossMoves).toBe(5);
  });

  it("rejects persisted white-cross lengths outside 1 through 7", () => {
    expect(mergeSettings({ whiteCrossMoves: 0 as never }).whiteCrossMoves).toBe(5);
    expect(mergeSettings({ whiteCrossMoves: 8 as never }).whiteCrossMoves).toBe(5);
  });
});

describe("migrateSession", () => {
  it("normalizes missing or invalid events to the canonical default", () => {
    expect(migrateSession({ id: "s", name: "Session 1", createdAt: 0 })).toMatchObject({
      event: DEFAULT_EVENT_ID,
    });
    expect(
      migrateSession({ id: "s", name: "Session 1", createdAt: 0, event: "not-an-event" }),
    ).toMatchObject({ event: DEFAULT_EVENT_ID });
  });

  it("keeps the persisted Session event when legacy solve data conflicts", () => {
    const session = migrateSession({
      id: "s",
      name: "Session 1",
      createdAt: 0,
      event: "222",
    });
    const solve = migrateSolve({ ...base, event: "333" });
    expect(session.event).toBe("222");
    expect(solve).not.toHaveProperty("event");
  });
});

const trainingAttempt = (values: Partial<TrainingAttempt> = {}): TrainingAttempt => ({
  id: "attempt", createdAt: 10, mode: "virtual", activity: "single", caseTimeMs: null,
  target: { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 1", position: "FR" },
  moves: ["R", "U"], stm: 2, elapsedMs: 500, recommendedStm: 2, matchedReferenceRank: 1, delta: 0, ...values,
});

describe("TrainingAttempt current-record normalization", () => {
  it("preserves old history as Single/null and accepts current Drill facts", () => {
    const { activity: _activity, caseTimeMs: _caseTime, ...old } = trainingAttempt();
    expect(normalizeTrainingAttempt(old)).toEqual(trainingAttempt());
    const drill = trainingAttempt({ activity: "drill", caseTimeMs: 2400 });
    expect(normalizeTrainingAttempt(drill)).toEqual(drill);
  });
  it.each([
    { activity: "invalid" }, { caseTimeMs: -1 }, { caseTimeMs: Infinity }, { caseTimeMs: NaN },
    { activity: "drill", caseTimeMs: null }, { activity: "drill", caseTimeMs: 2000, mode: "setup" },
    { activity: "single", caseTimeMs: 2000 },
  ])("rejects malformed activity/case timing %j", values => {
    expect(normalizeTrainingAttempt({ ...trainingAttempt(), ...values })).toBeNull();
  });
  it("keeps current facts and strips fields outside the historical contract", () => {
    const row = trainingAttempt();
    expect(normalizeTrainingAttempt({ ...row, sessionId: "timer", recommendedAlg: "R U" })).toEqual(row);
  });
  it.each([
    null, {}, { id: "" }, { createdAt: -1 }, { createdAt: Infinity }, { mode: "timer" },
    { moves: [1] }, { moves: [""] }, { moves: "R U" }, { stm: -1 }, { stm: 2.5 },
    { elapsedMs: NaN }, { elapsedMs: -1 }, { recommendedStm: "2" }, { matchedReferenceRank: 0 }, { delta: NaN },
  ])("rejects malformed fact %j", invalid => {
    const row = invalid === null ? invalid : { ...trainingAttempt(), ...invalid };
    // Empty object has no shape when imported on its own.
    expect(normalizeTrainingAttempt(invalid && !Object.keys(invalid).length ? invalid : row)).toBeNull();
  });
  it.each([
    { family: "f2l", origin: "catalog", library: "full", caseName: "F2L 1", position: "FR" },
    { family: "f2l", origin: "catalog", library: "basic", caseName: "missing", position: "FR" },
    { family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 1", position: "UF" },
    { family: "oll", origin: "catalog", trainingSet: "basic", caseId: "27", auf: 0 },
    { family: "oll", origin: "catalog", trainingSet: "2look", caseId: "27", auf: 0 },
    { family: "pll", origin: "catalog", trainingSet: "full", caseId: "T", auf: 4 },
    { family: "pll", origin: "solve-step", trainingSet: "2look", caseId: "Headlights", auf: 0, solveId: "s", stepName: "PLL" },
    { family: "pll", origin: "solve-step", trainingSet: "full", caseId: "T", auf: 0, solveId: "s", stepName: "OLL" },
  ])("rejects invalid target combination %j", target => {
    expect(normalizeTrainingAttempt({ ...trainingAttempt(), target })).toBeNull();
  });
  it.each([
    { family: "oll", origin: "catalog", trainingSet: "2look", caseId: "L-Shape", auf: 1 },
    { family: "pll", origin: "catalog", trainingSet: "2look", caseId: "Headlights", auf: 3 },
    { family: "pll", origin: "solve-step", trainingSet: "full", caseId: "T", auf: 0, solveId: "absent", stepName: "PLL" },
    { family: "f2l", origin: "solve-step", position: "FL", solveId: "absent", stepName: "F2L Slot 2" },
  ])("accepts current target %j independently of source Solve presence", target => {
    expect(normalizeTrainingAttempt({ ...trainingAttempt(), target, elapsedMs: 0, delta: null })?.target).toEqual(target);
  });
});

describe("Training IndexedDB adapter", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it("reports a transaction abort even after the put request succeeds", async () => {
    const error = new Error("Transaction aborted after put");
    const database = {
      transaction: () => {
        const transaction = { error, onabort: null as null | (() => void), objectStore: () => ({
          put: () => {
            queueMicrotask(() => transaction.onabort?.());
            return { result: "attempt" };
          },
        }) };
        return transaction;
      },
    };
    vi.stubGlobal("indexedDB", { open: () => {
      const request = { result: database, onsuccess: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
    vi.resetModules();
    const adapter = await import("./db");
    await expect(adapter.saveTrainingAttempt(trainingAttempt())).rejects.toBe(error);
  });
  it("upgrades v1 without replacing old stores, sorts loads, and upserts stable IDs with put", async () => {
    const stores = new Map<string, Map<string, unknown>>([
      ["sessions", new Map([["old-session", { id: "old-session" }]])],
      ["solves", new Map([["old-solve", { id: "old-solve" }]])],
      ["settings", new Map([["settings", { theme: "light" }]])],
    ]);
    const existing = [...stores.values()];
    const request = <T>(result: T) => {
      const req = { result, onsuccess: null as null | (() => void) };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    };
    const put = vi.fn();
    const createObjectStore = vi.fn((name: string, options: unknown) => {
      expect(options).toEqual({ keyPath: "id" }); stores.set(name, new Map());
    });
    const database = {
      objectStoreNames: { contains: (name: string) => stores.has(name) }, createObjectStore,
      transaction: (name: string) => {
        const tx = { oncomplete: null as null | (() => void), objectStore: () => ({
          getAll: () => request([...stores.get(name)!.values()]),
          put: (row: TrainingAttempt) => {
            put(name, row); stores.get(name)!.set(row.id, row);
            queueMicrotask(() => tx.oncomplete?.()); return request(row.id);
          },
        }) };
        return tx;
      },
    };
    const open = vi.fn(() => {
      const req = { result: database, onupgradeneeded: null as null | (() => void), onsuccess: null as null | (() => void) };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); }); return req;
    });
    vi.stubGlobal("indexedDB", { open });
    vi.resetModules();
    const adapter = await import("./db");
    expect(await adapter.loadTrainingAttempts()).toEqual([]);
    expect(open).toHaveBeenCalledExactlyOnceWith("cubetimer", 3);
    expect(createObjectStore).toHaveBeenCalledWith("trainingAttempts", { keyPath: "id" });
    expect(createObjectStore).toHaveBeenCalledWith("trainingDrillPresets", { keyPath: "id" });
    expect(createObjectStore).toHaveBeenCalledTimes(2);
    expect([...stores.values()].slice(0, 3)).toEqual(existing);
    const a = trainingAttempt({ id: "a", createdAt: 20 });
    const b = trainingAttempt({ id: "b", createdAt: 20 });
    const earlier = trainingAttempt({ id: "early", createdAt: 5 });
    await adapter.saveTrainingAttempt(b); await adapter.saveTrainingAttempt(a); await adapter.saveTrainingAttempt(earlier);
    await adapter.saveTrainingAttempt({ ...a, elapsedMs: 200 });
    expect(stores.get("trainingAttempts")!.size).toBe(3);
    expect(await adapter.loadTrainingAttempts()).toEqual([earlier, { ...a, elapsedMs: 200 }, b]);
    expect(put).toHaveBeenLastCalledWith("trainingAttempts", { ...a, elapsedMs: 200 });
  });
});

const drillPreset = (values: Partial<TrainingDrillPreset> = {}): TrainingDrillPreset => ({
  id: "preset", name: "Cases", createdAt: 10, updatedAt: 20,
  context: { family: "f2l", library: "basic", position: "FR" }, caseIds: ["F2L 4", "F2L 5"], strategy: "sequence", ...values,
});

describe("TrainingDrillPreset normalization", () => {
  it.each(["sequence", "random", "weighted"] as const)("accepts %s in Basic FR and Advanced BL", strategy => {
    for (const library of ["basic", "advanced"] as const) {
      const ids = f2lTrainingCatalogue(library).cases.slice(0, 3).map(c => c.name);
      const preset = drillPreset({ strategy, context: { family: "f2l", library, position: library === "basic" ? "FR" : "BL" }, caseIds: ids });
      expect(normalizeTrainingDrillPreset(preset)).toEqual(preset);
    }
  });
  it.each(["oll", "pll"] as const)("accepts Full and 2-Look %s and normalizes catalogue order/duplicates", family => {
    for (const trainingSet of ["full", "2look"] as const) {
      const ids = lastLayerCaseIds(family, trainingSet).slice(0, 3);
      const preset = drillPreset({ context: { family, trainingSet }, caseIds: [ids[2], ids[0], ids[2], ids[1]] });
      expect(normalizeTrainingDrillPreset({ ...preset, name: "  Cases  ", outcomes: [] })).toEqual({ ...preset, caseIds: ids });
    }
  });
  it("normalizes F2L order and rejects the whole list when any ID is unknown", () => {
    expect(normalizeTrainingDrillPreset(drillPreset({ caseIds: ["F2L 5", "F2L 4", "F2L 5"] }))?.caseIds).toEqual(["F2L 4", "F2L 5"]);
    expect(normalizeTrainingDrillPreset(drillPreset({ caseIds: ["F2L 4", "missing", "F2L 4"] }))).toBeNull();
  });
  it.each([
    { id: "" }, { id: " " }, { name: " " }, { name: "a".repeat(81) },
    { createdAt: -1 }, { createdAt: NaN }, { updatedAt: Infinity }, { updatedAt: 9 },
    { strategy: "bad" }, { strategy: null }, { caseIds: [] }, { caseIds: [3] },
    { context: { family: "bad" } }, { context: { family: "f2l", library: "full", position: "FR" } },
    { context: { family: "f2l", library: "basic", position: "UF" } },
    { context: { family: "f2l", library: "basic", position: "FR", trainingSet: "full" } },
    { context: { family: "oll", trainingSet: "bad" } },
    { context: { family: "pll", trainingSet: "full", library: "basic" }, caseIds: ["T"] },
    { context: { family: "oll", trainingSet: "full" }, caseIds: ["missing"] },
    { context: { family: "pll", trainingSet: "2look" }, caseIds: ["T"] },
  ])("rejects malformed preset %j", invalid => {
    expect(normalizeTrainingDrillPreset({ ...drillPreset(), ...invalid })).toBeNull();
  });
});

describe("Saved Drill IndexedDB v3 adapter", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it("preserves all v2 stores, adds only presets, upserts/deletes after commit and skips malformed rows in deterministic order", async () => {
    const stores = new Map<string, Map<string, unknown>>(["sessions", "solves", "settings", "trainingAttempts"].map(name => [name, new Map([["old", { id: "old" }]])]));
    const originals = [...stores.values()];
    const request = <T>(result: T) => {
      const req = { result, onsuccess: null as null | (() => void) };
      queueMicrotask(() => req.onsuccess?.()); return req;
    };
    const createObjectStore = vi.fn((name: string, options: unknown) => {
      expect(options).toEqual({ keyPath: "id" }); stores.set(name, new Map());
    });
    let complete: (() => void) | undefined;
    const database = {
      objectStoreNames: { contains: (name: string) => stores.has(name) }, createObjectStore,
      transaction: (name: string) => {
        const tx = { oncomplete: null as null | (() => void), objectStore: () => ({
          getAll: () => request([...stores.get(name)!.values()]),
          put: (row: TrainingDrillPreset) => { stores.get(name)!.set(row.id, row); complete = () => tx.oncomplete?.(); },
          delete: (id: string) => { stores.get(name)!.delete(id); complete = () => tx.oncomplete?.(); },
        }) }; return tx;
      },
    };
    const open = vi.fn(() => {
      const req = { result: database, onupgradeneeded: null as null | (() => void), onsuccess: null as null | (() => void) };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); }); return req;
    });
    vi.stubGlobal("indexedDB", { open }); vi.resetModules();
    const adapter = await import("./db");
    expect(await adapter.loadTrainingDrillPresets()).toEqual([]);
    expect(open).toHaveBeenCalledExactlyOnceWith("cubetimer", 3);
    expect(createObjectStore).toHaveBeenCalledExactlyOnceWith("trainingDrillPresets", { keyPath: "id" });
    expect([...stores.values()].slice(0, 4)).toEqual(originals);
    async function commit(write: Promise<void>) {
      let resolved = false; void write.then(() => { resolved = true; });
      await Promise.resolve(); await Promise.resolve();
      expect(resolved).toBe(false); complete!(); await write;
    }
    const a = drillPreset({ id: "a" }), b = drillPreset({ id: "b" }), latest = drillPreset({ id: "latest", updatedAt: 30 });
    await commit(adapter.saveTrainingDrillPreset(b)); await commit(adapter.saveTrainingDrillPreset(a));
    await commit(adapter.saveTrainingDrillPreset(latest)); await commit(adapter.saveTrainingDrillPreset({ ...a, name: "Edited" }));
    stores.get("trainingDrillPresets")!.set("bad", { ...a, id: "bad", caseIds: ["unknown"] });
    expect(await adapter.loadTrainingDrillPresets()).toEqual([latest, { ...a, name: "Edited" }, b]);
    expect(stores.get("trainingDrillPresets")!.size).toBe(4);
    await commit(adapter.deleteTrainingDrillPreset("a"));
    expect(await adapter.loadTrainingDrillPresets()).toEqual([latest, b]);
  });
  it.each(["save", "delete"])("reports %s transaction abort after a successful request", async action => {
    const error = new Error("aborted");
    const database = { transaction: () => {
      const tx = { error, onabort: null as null | (() => void), objectStore: () => ({
        put: () => queueMicrotask(() => tx.onabort?.()), delete: () => queueMicrotask(() => tx.onabort?.()),
      }) }; return tx;
    } };
    vi.stubGlobal("indexedDB", { open: () => {
      const req = { result: database, onsuccess: null as null | (() => void) };
      queueMicrotask(() => req.onsuccess?.()); return req;
    } }); vi.resetModules();
    const adapter = await import("./db");
    await expect(action === "save" ? adapter.saveTrainingDrillPreset(drillPreset()) : adapter.deleteTrainingDrillPreset("preset")).rejects.toBe(error);
  });
});
