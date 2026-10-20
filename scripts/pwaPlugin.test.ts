import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { DEV_PWA_CLEANUP_WORKER } from "./pwaPlugin";

it("cleans only this application's scoped asset cache, without touching history or reloading clients", async () => {
  const listeners: Record<string, (event: { waitUntil: (promise: Promise<void>) => void }) => void> = {};
  const remove = vi.fn().mockResolvedValue(true), unregister = vi.fn().mockResolvedValue(true);
  runInNewContext(DEV_PWA_CLEANUP_WORKER, {
    self: { addEventListener: (name: string, fn: typeof listeners[string]) => { listeners[name] = fn; },
      registration: { scope: "https://cube.test/", unregister }, clients: { claim: vi.fn().mockResolvedValue(undefined) } },
    caches: { keys: async () => ["cubetimer-precache-v2-https://cube.test/", "other-app-assets", "cubetimer-precache-v2-https://cube.test/other/"], delete: remove },
    get indexedDB() { throw new Error("Cleanup must never access user history"); },
  });
  let completed!: Promise<void>;
  listeners.activate({ waitUntil: promise => { completed = promise; } }); await completed;
  expect(remove).toHaveBeenCalledExactlyOnceWith("cubetimer-precache-v2-https://cube.test/");
  expect(unregister).toHaveBeenCalledOnce();
});
