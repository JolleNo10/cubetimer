import { Store } from "../shared/store";

type UpdateState = {
  status: "unavailable" | "development" | "registering" | "registered" | "error";
  offlineReady: boolean; updateAvailable: boolean; checking: boolean; pending: boolean; error: string | null;
};

/** Asset delivery only. Reload permission always comes from the live Controller. */
export class PwaUpdates {
  readonly state = new Store<UpdateState>({ status: "unavailable", offlineReady: false,
    updateAvailable: false, checking: false, pending: false, error: null });
  #registration?: ServiceWorkerRegistration;
  #container?: ServiceWorkerContainer;
  #canReload = () => false;
  #activationWorker?: ServiceWorker;
  #activated = false;
  #timer?: ReturnType<typeof setTimeout>;
  #watched = new WeakSet<ServiceWorker>();
  #cleanup: Array<() => void> = [];
  #started = false;
  constructor(private readonly reload: () => void = () => location.reload()) {}

  development(): void { this.state.update(s => ({ ...s, status: "development" })); }

  async register(container: ServiceWorkerContainer | undefined, canReload: () => boolean): Promise<void> {
    if (this.#started || !container) return;
    this.#started = true;
    this.#container = container;
    this.#canReload = canReload;
    this.state.update(s => ({ ...s, status: "registering" }));
    try {
      this.#registration = await container.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const inspect = () => this.#inspect();
      this.#registration.addEventListener("updatefound", inspect);
      this.#cleanup.push(() => this.#registration?.removeEventListener("updatefound", inspect));
      const previousController = container.controller;
      const controlled = () => {
        // Another tab may activate the same waiting update while this tab's explicit
        // request is queued. Only that pending user intent permits a safe reload.
        if (this.state.get().pending && container.controller &&
            container.controller !== previousController && container.controller.state === "activated") {
          this.#activated = true;
          this.#advance();
        }
      };
      container.addEventListener("controllerchange", controlled);
      this.#cleanup.push(() => container.removeEventListener("controllerchange", controlled));
      this.state.update(s => ({ ...s, status: "registered", error: null }));
      this.#inspect();
    } catch {
      this.state.update(s => ({ ...s, status: "error", error: "Offline installation could not start. Try checking again online." }));
      this.#started = false;
    }
  }

  #watch(worker: ServiceWorker): void {
    if (this.#watched.has(worker)) return;
    this.#watched.add(worker);
    const changed = () => {
      if (worker === this.#activationWorker && worker.state === "activated") {
        this.#activated = true;
        this.#advance();
      } else if (worker === this.#activationWorker && worker.state === "redundant") {
        this.#stopPending("The update could not activate. Check for updates again.");
      }
      this.#inspect();
    };
    worker.addEventListener("statechange", changed);
    this.#cleanup.push(() => worker.removeEventListener("statechange", changed));
  }

  #inspect(): void {
    const registration = this.#registration;
    if (!registration) return;
    for (const worker of [registration.installing, registration.waiting, registration.active]) {
      if (worker) this.#watch(worker);
    }
    this.state.update(s => ({ ...s, updateAvailable: Boolean(registration.waiting),
      offlineReady: registration.active?.state === "activated" || s.offlineReady }));
  }

  async checkForUpdate(): Promise<void> {
    if (this.state.get().checking) return;
    this.state.update(s => ({ ...s, checking: true, error: null }));
    try {
      if (!this.#registration) await this.register(this.#container, this.#canReload);
      if (!this.#registration) throw new Error("No registration");
      await this.#registration.update();
      this.#inspect();
    } catch {
      this.state.update(s => ({ ...s, error: "Could not check for updates. Connect to the internet and try again." }));
    } finally { this.state.update(s => ({ ...s, checking: false })); }
  }

  applyUpdate(): void {
    if (!this.#registration?.waiting || this.state.get().pending) return;
    this.state.update(s => ({ ...s, pending: true, error: null }));
    this.#advance();
  }

  #stopPending(error: string | null): void {
    clearTimeout(this.#timer); this.#timer = undefined;
    this.#activationWorker = undefined; this.#activated = false;
    this.state.update(s => ({ ...s, pending: false, error }));
  }

  #advance(): void {
    if (!this.state.get().pending) return;
    if (this.#canReload()) {
      if (this.#activated) {
        this.#stopPending(null);
        this.reload();
        return;
      }
      if (!this.#activationWorker && this.#registration?.waiting) {
        this.#activationWorker = this.#registration.waiting;
        this.#watch(this.#activationWorker);
        try { this.#activationWorker.postMessage({ type: "SKIP_WAITING" }); }
        catch { this.#stopPending("The update could not activate. Try again."); return; }
      }
    }
    // Poll only an explicitly requested update. Recheck at activation AND reload,
    // since an attempt may have started while the worker was activating.
    if (!this.#timer) this.#timer = setTimeout(() => { this.#timer = undefined; this.#advance(); }, 500);
  }

  dispose(): void {
    clearTimeout(this.#timer);
    this.#cleanup.forEach(off => off());
  }
}

export const pwaUpdates = new PwaUpdates();

/** Replace only this app's old production registration with the dev cleanup worker. */
export async function cleanupDevelopmentWorker(container?: ServiceWorkerContainer): Promise<void> {
  try {
    const registration = await container?.getRegistration("/");
    if (registration && registration.scope === `${location.origin}/` &&
        [registration.active, registration.waiting, registration.installing]
          .some(worker => worker?.scriptURL === `${location.origin}/sw.js`)) {
      await container!.register("/sw.js", { scope: "/", updateViaCache: "none" });
    }
  } catch { /* Development and user data stay usable when cleanup is unavailable. */ }
}
