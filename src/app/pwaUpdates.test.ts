import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaUpdates, cleanupDevelopmentWorker } from "./pwaUpdates";

class Worker extends EventTarget {
  state: ServiceWorkerState = "installed";
  scriptURL = "https://cube.test/sw.js";
  postMessage = vi.fn();
  transition(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event("statechange")); }
}
function fixture() {
  let safe = true;
  const current = new Worker(); current.state = "activated";
  const next = new Worker();
  const registration = Object.assign(new EventTarget(), { scope: "https://cube.test/",
    active: current as Worker | null, waiting: next as Worker | null, installing: null as Worker | null,
    update: vi.fn().mockResolvedValue(undefined) });
  const container = Object.assign(new EventTarget(), { controller: current as Worker | null,
    register: vi.fn().mockResolvedValue(registration), getRegistration: vi.fn().mockResolvedValue(registration) });
  const reload = vi.fn(), updates = new PwaUpdates(reload);
  return { updates, next, current, registration, container, reload,
    setSafe: (value: boolean) => { safe = value; },
    start: () => updates.register(container as unknown as ServiceWorkerContainer, () => safe),
    activate: () => { registration.waiting = null; registration.active = next; next.transition("activated"); } };
}
let cleanup: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("explicit safe PWA updates", () => {
  it.each([false, true])("reports failed precache installation while preserving an existing offline copy (%s)", async existing => {
    const f = fixture(); cleanup = () => f.updates.dispose();
    f.registration.active = existing ? f.current : null;
    f.registration.waiting = null;
    f.next.state = "installing";
    f.registration.installing = f.next;
    await f.start();
    f.registration.installing = null;
    f.next.transition("redundant");
    expect(f.updates.state.get()).toMatchObject({ status: "registered", offlineReady: existing, updateAvailable: false });
    expect(f.updates.state.get().error).toContain("finish installing");
    expect(f.reload).not.toHaveBeenCalled();
    const retry = new Worker(); retry.state = "installing";
    f.registration.installing = retry;
    f.registration.dispatchEvent(new Event("updatefound"));
    f.registration.installing = null; f.registration.waiting = retry;
    retry.transition("installed");
    expect(f.updates.state.get()).toMatchObject({ error: null, updateAvailable: true });
    expect(retry.postMessage).not.toHaveBeenCalled();
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("does not report successful workers becoming obsolete as installation failures", async () => {
    const f = fixture(); cleanup = () => f.updates.dispose();
    f.registration.waiting = null; f.next.state = "installing"; f.registration.installing = f.next;
    await f.start();
    f.registration.installing = null; f.registration.waiting = f.next;
    f.next.transition("installed");
    f.activate();
    f.current.transition("redundant");
    f.next.transition("redundant");
    expect(f.updates.state.get().error).toBeNull();
  });

  it("registers without automatic activation or reload, including background controller changes", async () => {
    const f = fixture(); cleanup = () => f.updates.dispose(); await f.start();
    expect(f.container.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(f.updates.state.get()).toMatchObject({ updateAvailable: true, offlineReady: true });
    f.activate(); f.container.controller = f.next; f.container.dispatchEvent(new Event("controllerchange"));
    expect(f.next.postMessage).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  });
  it("queues unsafe requests and checks safety again before reloading after activation", async () => {
    const f = fixture(); cleanup = () => f.updates.dispose(); await f.start();
    f.setSafe(false); f.updates.applyUpdate();
    vi.advanceTimersByTime(1500);
    expect(f.next.postMessage).not.toHaveBeenCalled(); expect(f.updates.state.get().pending).toBe(true);
    f.setSafe(true); vi.advanceTimersByTime(500);
    expect(f.next.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" });
    f.setSafe(false); f.activate(); vi.advanceTimersByTime(1000);
    expect(f.reload).not.toHaveBeenCalled();
    f.setSafe(true); vi.advanceTimersByTime(500);
    expect(f.reload).toHaveBeenCalledOnce(); expect(f.updates.state.get().pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps checks explicit and handles network/check and registration failures", async () => {
    const f = fixture(); cleanup = () => f.updates.dispose();
    f.container.register.mockRejectedValueOnce(new Error("denied")); await f.start();
    expect(f.updates.state.get().status).toBe("error");
    await f.updates.checkForUpdate(); expect(f.updates.state.get().status).toBe("registered");
    f.registration.update.mockRejectedValueOnce(new Error("offline"));
    await f.updates.checkForUpdate();
    expect(f.updates.state.get()).toMatchObject({ checking: false, updateAvailable: true });
    expect(f.updates.state.get().error).toContain("internet");
    expect(f.next.postMessage).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  });
  it("handles unavailable service workers without affecting startup", async () => {
    const f = fixture(); await f.updates.register(undefined, () => true);
    expect(f.updates.state.get().status).toBe("unavailable"); expect(f.reload).not.toHaveBeenCalled();
  });
});
it("targets only Cubetimer's own registration when switching to development", async () => {
  vi.stubGlobal("location", { origin: "https://cube.test" });
  const f = fixture();
  await cleanupDevelopmentWorker(f.container as unknown as ServiceWorkerContainer);
  expect(f.container.register).toHaveBeenCalledOnce();
  f.container.register.mockClear(); f.current.scriptURL = "https://cube.test/other/sw.js";
  f.registration.waiting = null;
  await cleanupDevelopmentWorker(f.container as unknown as ServiceWorkerContainer);
  expect(f.container.register).not.toHaveBeenCalled();
});

it("finishes an explicitly queued request if another tab activates, but still waits for safety", async () => {
  const f = fixture(); cleanup = () => f.updates.dispose(); await f.start();
  f.setSafe(false); f.updates.applyUpdate();
  f.activate(); f.container.controller = f.next; f.container.dispatchEvent(new Event("controllerchange"));
  expect(f.reload).not.toHaveBeenCalled(); expect(f.next.postMessage).not.toHaveBeenCalled();
  f.setSafe(true); vi.advanceTimersByTime(500); expect(f.reload).toHaveBeenCalledOnce();
});
