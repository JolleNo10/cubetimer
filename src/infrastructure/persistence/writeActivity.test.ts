import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../app/types";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("blocks reload from before database opening until every concurrent write commits", async () => {
  const transactions: Array<{ oncomplete?: () => void; objectStore: () => { put: () => void } }> = [];
  vi.stubGlobal("indexedDB", { open: () => {
    const request = { result: { transaction: () => {
      const transaction = { objectStore: () => ({ put: () => {} }) };
      transactions.push(transaction); return transaction;
    } }, onsuccess: null as null | (() => void) };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } });
  vi.resetModules(); const db = await import("./db");
  const first = db.saveSettings(DEFAULT_SETTINGS), second = db.saveSettings(DEFAULT_SETTINGS);
  expect(db.isWritingData()).toBe(true);
  await vi.waitFor(() => expect(transactions).toHaveLength(2));
  transactions[0].oncomplete?.(); await first;
  expect(db.isWritingData()).toBe(true);
  transactions[1].oncomplete?.(); await second;
  expect(db.isWritingData()).toBe(false);
});
it("releases write activity when storage opening fails without initializing a new database", async () => {
  const failure = new Error("storage denied");
  vi.stubGlobal("indexedDB", { open: () => {
    const request = { error: failure, onerror: null as null | (() => void) };
    queueMicrotask(() => request.onerror?.()); return request;
  } });
  vi.resetModules(); const db = await import("./db");
  const saving = db.saveSettings(DEFAULT_SETTINGS);
  expect(db.isWritingData()).toBe(true);
  await expect(saving).rejects.toBe(failure);
  expect(db.isWritingData()).toBe(false);
});
