import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alg } from "cubing/alg";
import { GyroInset } from "./GyroInset";
import { multiply, normalize, relative, type Quat } from "../../util/quat";
import { get3x3x3 } from "../../cube/puzzle";
import { solveAlg } from "../../cube/solver";
import { Controller } from "../../app/Controller";
import { CubeModel } from "../../cube/model";
import { SmartCube, type SmartCubeHandlers } from "../../infrastructure/bluetooth/smartCube";

const f = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  controller: null as Controller | null,
  players: [] as Array<{
    options: Record<string, unknown>; remove: ReturnType<typeof vi.fn>;
    experimentalAddMove: ReturnType<typeof vi.fn>; alg: string; setup: Alg;
    object: { quaternion: Quaternion; scheduleRender: ReturnType<typeof vi.fn> };
    experimentalCurrentThreeJSPuzzleObject: ReturnType<typeof vi.fn>;
  }>,
  host: { appendChild: vi.fn() }, reuseObject: false, inheritRotation: false,
}));
vi.mock("react", () => ({
  useRef: () => ({ current: f.host }),
  useEffect: (effect: () => (() => void) | undefined) => { f.effects.push(effect); },
}));
vi.mock("../../app/useController", () => ({ useController: () => f.controller }));
vi.mock("../../cube/solver", () => ({ solveAlg: vi.fn() }));
class Quaternion {
  x = 0; y = 0; z = 0; w = 1;
  set(x: number, y: number, z: number, w: number) { Object.assign(this, { x, y, z, w }); return this; }
  clone() { return new Quaternion().copy(this); }
  copy(q: Quat) { Object.assign(this, q); return this; }
  multiply(q: Quat) { return this.copy(multiply(this, q)); }
  slerp(q: Quat) { return this.copy(q); }
}
const home = normalize({ x: 0.1, y: 0, z: 0, w: 1 });
function renderObject() { return { quaternion: new Quaternion().copy(home), scheduleRender: vi.fn() }; }
vi.mock("cubing/twisty", () => ({ TwistyPlayer: class {
  remove = vi.fn(); experimentalAddMove = vi.fn();
  alg = ""; setup = new Alg(""); object = renderObject();
  constructor(public options: Record<string, unknown>) { f.players.push(this); }
  set experimentalSetupAlg(alg: Alg) {
    this.setup = alg;
    if (!f.reuseObject) {
      const previous = this.object;
      this.object = renderObject();
      if (f.inheritRotation) this.object.quaternion.copy(previous.quaternion);
    }
  }
  experimentalCurrentThreeJSPuzzleObject = vi.fn(() => Promise.resolve(this.object));
  experimentalCurrentVantages() { return Promise.resolve([this.object].values()); }
} }));
const kpuzzle = await get3x3x3();
let cleanup: (() => void) | undefined;
let handlers: SmartCubeHandlers;
beforeEach(() => {
  vi.clearAllMocks(); f.effects = []; f.players = []; f.reuseObject = false; f.inheritRotation = false;
  vi.mocked(solveAlg).mockReset().mockResolvedValue(new Alg(""));
  const capture = vi.spyOn(SmartCube.prototype, "setHandlers");
  f.controller = new Controller(new CubeModel(kpuzzle));
  handlers = capture.mock.calls.at(-1)![0];
  handlers.onStatus!("connected");
  handlers.onHardware!({ deviceName: "GAN", deviceMAC: "test", gyroSupported: true });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
async function mount() { GyroInset(); cleanup = f.effects[0](); await settle(); }
function tilt(degrees: number): Quat {
  return { x: 0, y: 0, z: Math.sin(degrees * Math.PI / 360), w: Math.cos(degrees * Math.PI / 360) };
}
function expectOrientation(q: Quat, expected: Quat) {
  for (const key of ["x", "y", "z", "w"] as const) expect(q[key]).toBeCloseTo(expected[key]);
}
function displayed(reference: Quat, pose: Quat) {
  const q = normalize(relative(reference, pose));
  return multiply({ x: q.x, y: q.z, z: -q.y, w: q.w }, home);
}
function deferred() {
  let resolve!: (value: Alg) => void, reject!: (error: Error) => void;
  const promise = new Promise<Alg>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function resync() { f.controller!.physical.setModel(new CubeModel(kpuzzle)); }

describe("GyroInset raw event lifecycle", () => {
  it("renders successive small tilts through the real unlocked and locked runtime without face moves or RAF", async () => {
    await mount();
    const player = f.players[0], object = player.object;
    const storeUpdates = vi.fn(), off = f.controller!.physical.state.subscribe(storeUpdates);
    handlers.onGyro!(tilt(0));
    for (const degrees of [3, 7, 12]) {
      const before = object.quaternion.clone(), count = object.scheduleRender.mock.calls.length;
      handlers.onGyro!(tilt(degrees));
      expectOrientation(object.quaternion, displayed(tilt(0), tilt(degrees)));
      expect(object.quaternion).not.toEqual(before);
      expect(object.scheduleRender).toHaveBeenCalledTimes(count + 1);
    }
    expect(f.controller!.timer.state.get().phase).toBe("scrambling");
    expect(f.controller!.physical.heldAs).toBeNull();
    f.controller!.physical.lockGripReference();
    expectOrientation(object.quaternion, home);
    handlers.onGyro!(tilt(18));
    expectOrientation(object.quaternion, displayed(tilt(12), tilt(18)));
    expect(f.controller!.resetGyro()).toBe(true);
    expectOrientation(object.quaternion, home);
    handlers.onGyro!(tilt(22));
    expectOrientation(object.quaternion, displayed(tilt(18), tilt(22)));
    expect(player.experimentalAddMove).not.toHaveBeenCalled();
    expect(storeUpdates).not.toHaveBeenCalled(); off();
    expect(f.effects).toHaveLength(1); expect(f.players).toHaveLength(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("establishes setup before binding and applies the latest samples received during initialization", async () => {
    const pending = deferred(); vi.mocked(solveAlg).mockReturnValueOnce(pending.promise);
    GyroInset(); cleanup = f.effects[0]();
    const player = f.players[0];
    expect(player.experimentalCurrentThreeJSPuzzleObject).not.toHaveBeenCalled();
    handlers.onGyro!(tilt(0)); handlers.onGyro!(tilt(8));
    pending.resolve(new Alg("R")); await settle();
    expect(player.setup.toString()).toBe("R'");
    expect(player.experimentalCurrentThreeJSPuzzleObject).toHaveBeenCalledOnce();
    expectOrientation(player.object.quaternion, displayed(tilt(0), tilt(8)));
  });
  it.each([false, true])("rebinds after setup replacement without double-applying home (reuse=%s)", async reuse => {
    await mount(); f.reuseObject = reuse; f.inheritRotation = true;
    const player = f.players[0], oldObject = player.object;
    handlers.onGyro!(tilt(0)); handlers.onGyro!(tilt(14));
    resync(); await settle();
    const newest = player.object;
    if (!reuse) expect(newest).not.toBe(oldObject);
    expectOrientation(newest.quaternion, displayed(tilt(0), tilt(14)));
    const oldRenders = oldObject.scheduleRender.mock.calls.length;
    handlers.onGyro!(tilt(17));
    expectOrientation(newest.quaternion, displayed(tilt(0), tilt(17)));
    if (!reuse) expect(oldObject.scheduleRender).toHaveBeenCalledTimes(oldRenders);
  });
  it.each([false, true])("keeps moves visible during async resync, replaying only on success (%s)", async success => {
    await mount();
    const pending = deferred(), player = f.players[0], oldSetup = player.setup;
    vi.mocked(solveAlg).mockReturnValueOnce(pending.promise);
    resync(); f.controller!.injectMove("F");
    expect(player.experimentalAddMove).toHaveBeenCalledExactlyOnceWith("F", { cancel: false });
    if (success) pending.resolve(new Alg("R")); else pending.reject(new Error("solver failed"));
    await settle();
    expect(player.experimentalAddMove).toHaveBeenCalledTimes(success ? 2 : 1);
    if (success) expect(player.setup.toString()).toBe("R'");
    else expect(player.setup).toBe(oldSetup);
    handlers.onGyro!(tilt(0)); handlers.onGyro!(tilt(6));
    expectOrientation(player.object.quaternion, displayed(tilt(0), tilt(6)));
  });
  it("ignores stale calculations and late render bindings after replacement/unmount", async () => {
    await mount();
    const first = deferred(), second = deferred(), player = f.players[0];
    vi.mocked(solveAlg).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    resync(); resync(); second.resolve(new Alg("U")); await settle();
    const object = player.object;
    first.resolve(new Alg("R")); await settle();
    expect(player.setup.toString()).toBe("U'"); expect(player.object).toBe(object);
    cleanup?.(); cleanup = undefined;
    const count = player.experimentalAddMove.mock.calls.length, renders = object.scheduleRender.mock.calls.length;
    handlers.onGyro!(tilt(9)); f.controller!.injectMove("R"); resync();
    expect(f.controller!.resetGyro()).toBe(true);
    expect(player.experimentalAddMove).toHaveBeenCalledTimes(count);
    expect(object.scheduleRender).toHaveBeenCalledTimes(renders);
    expect(player.remove).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

function deferredObject() {
  let resolve!: (value: ReturnType<typeof renderObject>) => void;
  const promise = new Promise<ReturnType<typeof renderObject>>(yes => { resolve = yes; });
  return { promise, resolve };
}
it("rejects render handles acquired late after a newer setup or disposal", async () => {
  await mount();
  const player = f.players[0], staleBinding = deferredObject();
  player.experimentalCurrentThreeJSPuzzleObject.mockReturnValueOnce(staleBinding.promise);
  resync(); await settle();
  const staleObject = player.object;
  resync(); await settle();
  const newest = player.object;
  handlers.onGyro!(tilt(0)); handlers.onGyro!(tilt(9));
  staleBinding.resolve(staleObject); await settle();
  handlers.onGyro!(tilt(13));
  expectOrientation(newest.quaternion, displayed(tilt(0), tilt(13)));
  expect(staleObject.scheduleRender).not.toHaveBeenCalled();
  const disposedBinding = deferredObject();
  player.experimentalCurrentThreeJSPuzzleObject.mockReturnValueOnce(disposedBinding.promise);
  resync(); await settle();
  const removedObject = player.object;
  cleanup?.(); cleanup = undefined;
  disposedBinding.resolve(removedObject); await settle();
  expect(removedObject.scheduleRender).not.toHaveBeenCalled();
});
it("counts replayed moves toward the next compaction", async () => {
  await mount();
  const pending = deferred(); vi.mocked(solveAlg).mockReturnValueOnce(pending.promise);
  resync();
  for (let i = 0; i < 400; i++) f.controller!.injectMove("R");
  expect(solveAlg).toHaveBeenCalledTimes(2);
  pending.resolve(new Alg("")); await settle();
  f.controller!.injectMove("R");
  expect(solveAlg).toHaveBeenCalledTimes(3);
  await settle();
});
