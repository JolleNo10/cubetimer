/** Best effort only: denial must never change startup or existing IndexedDB data. */
export async function requestPersistentStorage(storage?: Pick<StorageManager, "persisted" | "persist">): Promise<boolean> {
  try {
    if (!storage || typeof storage.persisted !== "function" || typeof storage.persist !== "function") return false;
    return await storage.persisted() || await storage.persist();
  } catch { return false; }
}
