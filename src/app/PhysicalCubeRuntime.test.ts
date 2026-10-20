import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartCube, type SmartCubeHandlers } from "../infrastructure/bluetooth/smartCube";
import { CubeModel } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import { PhysicalCubeRuntime } from "./PhysicalCubeRuntime";
const kpuzzle = await get3x3x3();
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const handlers = vi.spyOn(SmartCube.prototype, "setHandlers");
  const model = new CubeModel(kpuzzle), onMove = vi.fn(), onPatternChanged = vi.fn(), reportError = vi.fn();
  let replace = true;
  let phase: import("../features/timer/TimerRuntime").TimerPhase = "ready";
  const physical = new PhysicalCubeRuntime({
    getTimerPhase: () => phase, getTimerElapsed: () => null,
    canReplacePattern: () => replace, reportError, onMove, onPatternChanged
  }, model);
  return {
    model, physical, onMove, onPatternChanged, reportError, handlers: handlers.mock.calls.at(-1)![0] as SmartCubeHandlers,
    setPhase: (value: typeof phase) => { phase = value; },
    setReplace: (value: boolean) => { replace = value; }
  };
}
describe("PhysicalCubeRuntime", () => {
  it("routes hardware and injected input after applying the same physical model", () => {
    const f = fixture(), observer = vi.fn(); f.physical.onCubeMove(observer);
    const before = f.model.pattern; f.physical.injectMove("R");
    expect(f.onMove.mock.calls[0][1]).toBe(before);
    expect(f.model.pattern.isIdentical(before.applyMove("R"))).toBe(true);
    const next = f.model.pattern;
    f.handlers.onMove!({ serial: 1, face: 0, direction: 0, move: "U", localTimestamp: 0, cubeTimestamp: 0 });
    expect(f.model.pattern.isIdentical(next.applyMove("U"))).toBe(true);
    expect(observer.mock.calls).toEqual([["R"], ["U"]]);
    expect(f.physical.state.get().cubeFacelets).toBe(f.model.facelets);
  });
  it("publishes device facts and clears them on disconnect", () => {
    const f = fixture(); const hardware = { deviceName: "GAN", deviceMAC: "test", gyroSupported: true };
    f.handlers.onStatus!("connected"); f.handlers.onHardware!(hardware); f.handlers.onBattery!(87);
    expect(f.physical.state.get()).toMatchObject({ cubeStatus: "connected", hardware, battery: 87 });
    expect(f.physical.hasCube).toBe(true); f.handlers.onStatus!("disconnected", "lost connection");
    expect(f.physical.state.get()).toMatchObject({ hardware: null, battery: null });
    expect(f.reportError).toHaveBeenLastCalledWith("lost connection");
  });
  it("resynchronizes complete facelets, rejects garbled reports and protects active attempts", () => {
    const f = fixture(), reset = vi.fn(); f.physical.onPatternReset(reset);
    const target = new CubeModel(kpuzzle); target.applyMove("R");
    f.setReplace(false); f.handlers.onFacelets!(target.facelets, 1); expect(reset).not.toHaveBeenCalled();
    f.setReplace(true); f.handlers.onFacelets!(target.facelets, 2); expect(f.model.facelets).toBe(target.facelets);
    expect(reset).toHaveBeenCalledOnce(); f.handlers.onFacelets!("garbled", 3); expect(reset).toHaveBeenCalledOnce();
  });
  it("owns gyro reference and U-turn recentre observations", () => {
    const f = fixture(), recentre = vi.fn(); f.physical.onRecentreView(recentre);
    f.handlers.onStatus!("connected");
    f.handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: true });
    f.handlers.onGyro!({ x: 0, y: 0, z: 0, w: 1 }); f.physical.lockGripReference();
    expect(f.physical.gripLocked).toBe(true); expect(f.physical.gripReference).not.toBeNull();
    for (let i = 0;i < 4;i++) f.physical.observeTimerMove("U", "ready");
    expect(recentre).toHaveBeenCalledOnce(); f.physical.resetGrip(); expect(f.physical.gripLocked).toBe(false);
  });
});

describe("shared gyro reset", () => {
  function connected() {
    const f = fixture();
    f.handlers.onStatus!("connected");
    f.handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: true });
    return f;
  }
  it("refuses missing samples, unsupported hardware, disconnects and protected phases", () => {
    const f = connected(), changed = vi.fn(); f.physical.onRecentreView(changed);
    expect(f.physical.resetGyro()).toBe(false);
    f.handlers.onGyro!({ x: 0, y: 0, z: 0, w: 1 });
    for (const phase of ["inspection", "solving"] as const) {
      f.setPhase(phase); expect(f.physical.resetGyro()).toBe(false);
      for (let i = 0; i < 4; i++) f.physical.observeTimerMove("U", phase);
    }
    f.setPhase("ready");
    f.handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: false });
    expect(f.physical.resetGyro()).toBe(false);
    f.handlers.onStatus!("disconnected");
    expect(f.physical.resetGyro()).toBe(false);
    f.handlers.onStatus!("connected");
    f.handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: true });
    expect(f.physical.resetGyro()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
  it("rebases direct and gesture requests identically, notifying once per complete sequence", () => {
    const f = connected(), changed = vi.fn(), gyro = vi.fn();
    const off = f.physical.onRecentreView(changed), offGyro = f.physical.onGyro(gyro);
    f.handlers.onGyro!({ x: 0, y: 0, z: 0, w: 1 }); f.physical.lockGripReference();
    const q = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    f.handlers.onGyro!(q);
    const pattern = f.physical.pattern;
    expect(f.physical.resetGyro()).toBe(true);
    expect(f.physical.gripReference).toEqual(q);
    expect(f.physical.heldAs).toMatchObject({ U: "U", F: "F" });
    expect(f.physical.pattern).toBe(pattern);
    changed.mockClear();
    for (let i = 0; i < 3; i++) f.physical.observeTimerMove("U'", "scrambling");
    expect(changed).not.toHaveBeenCalled();
    f.physical.observeTimerMove("U'", "scrambling"); expect(changed).toHaveBeenCalledOnce();
    f.physical.observeTimerMove("U'", "scrambling"); expect(changed).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) f.physical.observeTimerMove("U'", "scrambling");
    expect(changed).toHaveBeenCalledTimes(2);
    off(); offGyro();
    expect(f.physical.resetGyro()).toBe(true);
    f.handlers.onGyro!(q);
    expect(changed).toHaveBeenCalledTimes(2); expect(gyro).toHaveBeenCalledTimes(2);
  });
});
