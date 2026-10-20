import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "./storagePersistence";

describe("best-effort storage persistence", () => {
  it("does not block startup on denial, unsupported APIs or failures", async () => {
    expect(await requestPersistentStorage()).toBe(false);
    expect(await requestPersistentStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) })).toBe(false);
    expect(await requestPersistentStorage({ persisted: vi.fn().mockRejectedValue(new Error("unavailable")), persist: vi.fn() })).toBe(false);
    expect(await requestPersistentStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockRejectedValue(new Error("denied")) })).toBe(false);
  });
  it("enrolls when supported and skips another request if already persisted", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    expect(await requestPersistentStorage({ persisted: vi.fn().mockResolvedValue(false), persist })).toBe(true);
    expect(persist).toHaveBeenCalledOnce(); persist.mockClear();
    expect(await requestPersistentStorage({ persisted: vi.fn().mockResolvedValue(true), persist })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
});
