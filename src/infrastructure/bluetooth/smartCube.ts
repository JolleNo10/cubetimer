import {
  connectGanCube,
  cubeTimestampLinearFit,
  type GanCubeConnection,
  type GanCubeEvent,
  type GanCubeMove,
  type MacAddressProvider,
} from "gan-web-bluetooth";
import type { Subscription } from "rxjs";

export type CubeStatus = "unsupported" | "disconnected" | "connecting" | "connected";

export type CubeHardware = {
  deviceName: string;
  deviceMAC: string;
  hardwareName?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
  productDate?: string;
  gyroSupported?: boolean;
};

export type Quaternion = { x: number; y: number; z: number; w: number };

export type SmartCubeHandlers = {
  onMove?: (move: GanCubeMove & { serial: number }) => void;
  onFacelets?: (facelets: string, serial: number) => void;
  onGyro?: (quaternion: Quaternion) => void;
  onBattery?: (level: number) => void;
  onHardware?: (hardware: CubeHardware) => void;
  onStatus?: (status: CubeStatus, error?: string) => void;
};

/** Asked for a MAC address when the browser will not reveal one (Chrome on macOS/Windows). */
export type MacPrompt = (deviceName: string) => Promise<string | null>;

const MAC_STORAGE_KEY = "cubetimer.macAddresses";
const BATTERY_POLL_MS = 60_000;

function readStoredMacs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MAC_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function storeMac(deviceName: string, mac: string): void {
  const macs = readStoredMacs();
  macs[deviceName] = mac;
  localStorage.setItem(MAC_STORAGE_KEY, JSON.stringify(macs));
}

export function forgetStoredMacs(): void {
  localStorage.removeItem(MAC_STORAGE_KEY);
}

export function bluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

/**
 * Owns the Bluetooth connection to a GAN smart cube.
 *
 * Supported hardware comes from `gan-web-bluetooth`, which covers the Gen2 protocol
 * (GAN 12 ui, GAN 12 ui FreePlay, GAN Mini ui FreePlay, GAN 356 i Carry/S, GAN 356 i 3,
 * Monster Go 3Ai, MoYu AI 2023), Gen3 (GAN 356 i Carry 2) and Gen4 (GAN 12 ui Maglev,
 * GAN 14 ui FreePlay). The right protocol is picked from the BLE services the cube
 * advertises, so no model selection is needed.
 */
export class SmartCube {
  #connection: GanCubeConnection | null = null;
  #subscription: Subscription | null = null;
  #batteryTimer: ReturnType<typeof setInterval> | null = null;
  #handlers: SmartCubeHandlers = {};
  #status: CubeStatus = bluetoothAvailable() ? "disconnected" : "unsupported";

  setHandlers(handlers: SmartCubeHandlers): void {
    this.#handlers = handlers;
  }

  get status(): CubeStatus {
    return this.#status;
  }

  get connected(): boolean {
    return this.#status === "connected";
  }

  async connect(macPrompt?: MacPrompt): Promise<void> {
    if (!bluetoothAvailable()) {
      this.#setStatus(
        "unsupported",
        "This browser has no Web Bluetooth. Use Chrome, Edge or Bluefy.",
      );
      return;
    }
    if (this.#connection) await this.disconnect();

    this.#setStatus("connecting");
    try {
      const connection = await connectGanCube(this.#macProvider(macPrompt));
      this.#connection = connection;
      this.#subscription = connection.events$.subscribe((event) =>
        this.#handleEvent(event),
      );
      this.#setStatus("connected");
      storeMac(connection.deviceName, connection.deviceMAC);

      await connection.sendCubeCommand({ type: "REQUEST_HARDWARE" });
      await connection.sendCubeCommand({ type: "REQUEST_BATTERY" });
      await connection.sendCubeCommand({ type: "REQUEST_FACELETS" });

      this.#batteryTimer = setInterval(() => {
        void this.#connection?.sendCubeCommand({ type: "REQUEST_BATTERY" });
      }, BATTERY_POLL_MS);
    } catch (error) {
      this.#connection = null;
      const message = error instanceof Error ? error.message : String(error);
      // A cancelled chooser is a normal outcome, not a failure worth shouting about.
      this.#setStatus(
        "disconnected",
        /User cancelled|cancelled the requestDevice/i.test(message)
          ? undefined
          : message,
      );
    }
  }

  async disconnect(): Promise<void> {
    this.#subscription?.unsubscribe();
    this.#subscription = null;
    if (this.#batteryTimer !== null) clearInterval(this.#batteryTimer);
    this.#batteryTimer = null;
    const connection = this.#connection;
    this.#connection = null;
    this.#setStatus("disconnected");
    await connection?.disconnect().catch(() => {});
  }

  /** Ask the cube to re-send its current state, e.g. after the app fell out of sync. */
  requestFacelets(): Promise<void> {
    return this.#connection?.sendCubeCommand({ type: "REQUEST_FACELETS" }) ??
      Promise.resolve();
  }

  /** Tell the cube its current physical state *is* solved. Only valid when it really is. */
  requestReset(): Promise<void> {
    return this.#connection?.sendCubeCommand({ type: "REQUEST_RESET" }) ??
      Promise.resolve();
  }

  requestBattery(): Promise<void> {
    return this.#connection?.sendCubeCommand({ type: "REQUEST_BATTERY" }) ??
      Promise.resolve();
  }

  #macProvider(macPrompt?: MacPrompt): MacAddressProvider {
    return async (device, isFallbackCall) => {
      const known = readStoredMacs()[device.name ?? ""];
      if (known) return known;
      if (!isFallbackCall) return null; // Let the library read it from advertisements.
      if (!macPrompt) return null;
      const mac = await macPrompt(device.name ?? "cube");
      if (mac && device.name) storeMac(device.name, mac);
      return mac;
    };
  }

  #handleEvent(event: GanCubeEvent): void {
    switch (event.type) {
      case "MOVE":
        this.#handlers.onMove?.(event);
        break;
      case "FACELETS":
        this.#handlers.onFacelets?.(event.facelets, event.serial);
        break;
      case "GYRO":
        this.#handlers.onGyro?.(event.quaternion);
        break;
      case "BATTERY":
        this.#handlers.onBattery?.(event.batteryLevel);
        break;
      case "HARDWARE":
        this.#handlers.onHardware?.({
          deviceName: this.#connection?.deviceName ?? "",
          deviceMAC: this.#connection?.deviceMAC ?? "",
          hardwareName: event.hardwareName,
          softwareVersion: event.softwareVersion,
          hardwareVersion: event.hardwareVersion,
          productDate: event.productDate,
          gyroSupported: event.gyroSupported,
        });
        break;
      case "DISCONNECT":
        void this.disconnect();
        break;
    }
  }

  #setStatus(status: CubeStatus, error?: string): void {
    this.#status = status;
    this.#handlers.onStatus?.(status, error);
  }
}

/**
 * Convert a solve's raw moves into millisecond offsets from the first move.
 *
 * Smart cube clocks drift by a fraction of a percent, so the cube timestamps are fitted
 * against the host clock first — the approach csTimer uses — which removes the drift
 * while keeping the cube's much better resolution on individual turns.
 */
export function fitMoveTimestamps(moves: GanCubeMove[]): number[] {
  if (moves.length === 0) return [];
  const usable = moves.every((m) => m.cubeTimestamp !== null);
  const fitted = usable ? cubeTimestampLinearFit(moves) : moves;
  const stamps = fitted.map(
    (m, i) => m.cubeTimestamp ?? m.localTimestamp ?? moves[i].localTimestamp ?? 0,
  );
  const base = stamps[0];
  return stamps.map((t) => t - base);
}
