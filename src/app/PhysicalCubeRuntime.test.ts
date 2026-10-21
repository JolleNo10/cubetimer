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
  it.each(["inspection", "solving"] as const)("refuses Mark solved during Timer %s", async phase => {
    const f = fixture(); f.model.applyMove("R");
    f.setPhase(phase);
    const reset = vi.spyOn(f.physical.cube, "requestReset").mockResolvedValue();
    vi.spyOn(f.physical.cube, "connected", "get").mockReturnValue(true);
    const before = f.model.pattern;
    await f.physical.markCubeSolved();
    expect(reset).not.toHaveBeenCalled();
    expect(f.model.pattern).toBe(before);
    expect(f.reportError).toHaveBeenCalled();
  });
  it("does not overwrite newer moves when a hardware reset completes late", async () => {
    const f = fixture(); f.model.applyMove("R");
    let finish!: () => void;
    vi.spyOn(f.physical.cube, "connected", "get").mockReturnValue(true);
    vi.spyOn(f.physical.cube, "requestReset").mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = f.physical.markCubeSolved();
    f.physical.injectMove("U"); const moved = f.model.pattern;
    finish(); await pending;
    expect(f.model.pattern).toBe(moved);
  });
  it("refuses Mark solved when Training owns an active attempt", async () => {
    const f = fixture(); f.model.applyMove("R"); f.setReplace(false);
    const before = f.model.pattern;
    await f.physical.markCubeSolved();
    expect(f.model.pattern).toBe(before);
  });
  it.each(["inspection", "disconnect", "reconnect", "failure"] as const)("preserves the pattern when %s interrupts Mark solved", async interruption => {
    const f = fixture(); f.model.applyMove("R");
    const before = f.model.pattern;
    let finish!: () => void, fail!: (error: Error) => void;
    vi.spyOn(f.physical.cube, "connected", "get").mockReturnValue(true);
    vi.spyOn(f.physical.cube, "requestReset").mockReturnValue(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const pending = f.physical.markCubeSolved();
    if (interruption === "inspection") f.setPhase("inspection");
    if (interruption === "disconnect" || interruption === "reconnect") f.handlers.onStatus!("disconnected");
    if (interruption === "reconnect") f.handlers.onStatus!("connected");
    if (interruption === "failure") fail(new Error("GATT failed"));
    else finish();
    await pending;
    expect(f.model.pattern).toBe(before);
    expect(f.onPatternChanged).not.toHaveBeenCalled();
    if (interruption === "failure") expect(f.reportError).toHaveBeenCalledWith(expect.stringContaining("Could not mark"));
  });
  it("still marks an idle unchanged cube solved and publishes its pattern", async () => {
    const f = fixture(); f.model.applyMove("R");
    await f.physical.markCubeSolved();
    expect(f.model.pattern.isIdentical(kpuzzle.defaultPattern())).toBe(true);
    expect(f.onPatternChanged).toHaveBeenCalledExactlyOnceWith(true);
  });
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
    const f = fixture(), recentre = vi.fn(); f.physical.onGyroReferenceChange(recentre);
    f.handlers.onStatus!("connected");
    f.handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: true });
    f.handlers.onGyro!({ x: 0, y: 0, z: 0, w: 1 }); f.physical.lockGripReference();
    expect(f.physical.gripLocked).toBe(true); expect(f.physical.gripReference).not.toBeNull();
    for (let i = 0;i < 4;i++) f.physical.observeTimerMove("U", "ready");
    expect(recentre).toHaveBeenCalledExactlyOnceWith("reset"); f.physical.resetGrip(); expect(f.physical.gripLocked).toBe(false);
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
    const f = connected(), changed = vi.fn(); f.physical.onGyroReferenceChange(changed);
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
    const off = f.physical.onGyroReferenceChange(changed), offGyro = f.physical.onGyro(gyro);
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
    expect(changed.mock.calls).toEqual([["reset"], ["reset"]]);
    off(); offGyro();
    expect(f.physical.resetGyro()).toBe(true);
    f.handlers.onGyro!(q);
    expect(changed).toHaveBeenCalledTimes(2); expect(gyro).toHaveBeenCalledTimes(2);
  });
});

describe("raw gyro reference lifecycle", () => {
  it("publishes unlocked samples without chasing the shared reference, and announces only actual scramble changes", () => {
    const f = fixture(), raw = vi.fn(), changes = vi.fn();
    f.setPhase("scrambling");
    const offRaw = f.physical.onGyro(raw), offChanges = f.physical.onGyroReferenceChange(changes);
    const zero = { x: 0, y: 0, z: 0, w: 1 };
    const tilted = { x: 0.1, y: 0, z: 0, w: Math.sqrt(0.99) };
    f.handlers.onGyro!(zero); f.handlers.onGyro!(tilted);
    expect(raw.mock.calls).toEqual([[zero], [tilted]]);
    expect(f.onMove).not.toHaveBeenCalled();
    expect(f.physical.gripReference).toEqual(zero);
    expect(f.physical.heldAs).toBeNull();
    f.physical.lockGripReference();
    expect(f.physical.gripReference).toEqual(tilted);
    expect(f.physical.heldAs).toMatchObject({ U: "U", F: "F" });
    expect(changes.mock.calls).toEqual([["scramble-lock"]]);
    f.physical.lockGripReference();
    f.physical.resetGrip(); f.physical.lockGripReference();
    expect(changes).toHaveBeenCalledOnce();
    offRaw(); offChanges();
    f.physical.resetGrip(); f.handlers.onGyro!(zero); f.physical.lockGripReference();
    expect(raw).toHaveBeenCalledTimes(2); expect(changes).toHaveBeenCalledOnce();
    f.handlers.onStatus!("disconnected");
    expect(f.physical.gripReference).toBeNull(); expect(f.physical.pose).toBeNull();
    expect(f.physical.gripLocked).toBe(false);
  });
  it("ignores invalid raw samples and retains an explicit reset across later scrambling samples", () => {
    const f = fixture(), raw = vi.fn(), changes = vi.fn();
    f.handlers.onStatus!("connected");
    f.handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: true });
    f.physical.onGyro(raw); f.physical.onGyroReferenceChange(changes);
    f.handlers.onGyro!({ x: 0, y: 0, z: 0, w: 0 });
    f.handlers.onGyro!({ x: Infinity, y: 0, z: 0, w: 1 });
    expect(f.physical.resetGyro()).toBe(false); expect(raw).not.toHaveBeenCalled();
    const q = { x: 0, y: 0, z: 0, w: 1 };
    f.handlers.onGyro!(q); expect(f.physical.resetGyro()).toBe(true);
    f.handlers.onGyro!({ x: 0.1, y: 0, z: 0, w: Math.sqrt(0.99) });
    expect(f.physical.gripReference).toEqual(q);
    expect(changes.mock.calls).toEqual([["reset"]]);
  });
});
