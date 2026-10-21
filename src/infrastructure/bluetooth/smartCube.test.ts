import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { connectGanCube, type GanCubeConnection, type GanCubeEvent } from "gan-web-bluetooth";
import { SmartCube } from "./smartCube";

vi.mock("gan-web-bluetooth", () => ({ connectGanCube: vi.fn(), cubeTimestampLinearFit: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function connection() {
  const events$ = new Subject<GanCubeEvent>();
  return { events$, deviceName: "GAN", deviceMAC: "test", sendCubeCommand: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined) };
}
const transport = (c: ReturnType<typeof connection>) => c as unknown as GanCubeConnection;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { bluetooth: {} });
  vi.stubGlobal("localStorage", { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("SmartCube connection lifecycle", () => {
  it("keeps local Bluetooth input usable when MAC storage or a later battery poll fails", async () => {
    const c = connection(), cube = new SmartCube(), battery = vi.fn();
    cube.setHandlers({ onBattery: battery });
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("Storage denied"); });
    vi.mocked(connectGanCube).mockResolvedValue(transport(c));
    await cube.connect();
    expect(cube.connected).toBe(true);
    c.events$.next({ type: "BATTERY", batteryLevel: 75 } as GanCubeEvent);
    expect(battery).toHaveBeenCalledWith(75);
    c.sendCubeCommand.mockRejectedValueOnce(new Error("Temporary GATT failure"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cube.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.sendCubeCommand).toHaveBeenCalledTimes(5);
    await cube.disconnect();
  });

  it("releases the subscription and hardware after initialization fails", async () => {
    const c = connection(), cube = new SmartCube(), battery = vi.fn();
    cube.setHandlers({ onBattery: battery });
    vi.mocked(connectGanCube).mockResolvedValue(transport(c));
    c.sendCubeCommand.mockRejectedValueOnce(new Error("GATT failed"));
    await cube.connect();
    expect(cube.status).toBe("disconnected");
    expect(c.disconnect).toHaveBeenCalledOnce();
    c.events$.next({ type: "BATTERY", batteryLevel: 25 } as GanCubeEvent);
    expect(battery).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a chooser result after disconnect", async () => {
    const c = connection(), cube = new SmartCube(), chosen = deferred<GanCubeConnection>();
    vi.mocked(connectGanCube).mockReturnValue(chosen.promise);
    const pending = cube.connect();
    await cube.disconnect();
    chosen.resolve(transport(c)); await pending;
    expect(cube.status).toBe("disconnected");
    expect(c.disconnect).toHaveBeenCalledOnce();
    expect(c.sendCubeCommand).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resume old initialization after a newer connection is established", async () => {
    const old = connection(), next = connection(), cube = new SmartCube(), hardware = deferred<void>();
    vi.mocked(connectGanCube).mockResolvedValueOnce(transport(old)).mockResolvedValueOnce(transport(next));
    old.sendCubeCommand.mockReturnValueOnce(hardware.promise);
    const pending = cube.connect(); await Promise.resolve();
    await cube.disconnect(); await cube.connect();
    hardware.resolve(); await pending;
    expect(cube.status).toBe("connected");
    expect(old.sendCubeCommand).toHaveBeenCalledTimes(1);
    expect(next.sendCubeCommand).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    await cube.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a stale initialization failure without disconnecting the replacement", async () => {
    const old = connection(), next = connection(), cube = new SmartCube(), hardware = deferred<void>(), battery = vi.fn();
    cube.setHandlers({ onBattery: battery });
    vi.mocked(connectGanCube).mockResolvedValueOnce(transport(old)).mockResolvedValueOnce(transport(next));
    old.sendCubeCommand.mockReturnValueOnce(hardware.promise);
    const pending = cube.connect(); await Promise.resolve();
    await cube.connect();
    hardware.reject(new Error("Old connection failed")); await pending;
    old.events$.next({ type: "BATTERY", batteryLevel: 1 } as GanCubeEvent);
    next.events$.next({ type: "BATTERY", batteryLevel: 80 } as GanCubeEvent);
    expect(battery.mock.calls).toEqual([[80]]);
    expect(cube.connected).toBe(true);
    expect(next.disconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await cube.disconnect();
  });
});
