import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alg } from "cubing/alg";
import { GyroInset } from "./GyroInset";
import { multiply, type Quat } from "../../util/quat";
import { get3x3x3 } from "../../cube/puzzle";
import { solveAlg } from "../../cube/solver";

const f = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  controller: null as unknown,
  players: [] as Array<{ options: Record<string, unknown>; remove: ReturnType<typeof vi.fn>; experimentalAddMove: ReturnType<typeof vi.fn>; alg?: string; experimentalSetupAlg?: Alg }>,
  host: { appendChild: vi.fn() },
}));
vi.mock("react", () => ({
  useRef: () => ({ current: f.host }),
  useEffect: (effect: () => (() => void) | undefined) => { f.effects.push(effect); },
}));
vi.mock("../../app/useController", () => ({ useController: () => f.controller }));
vi.mock("../../cube/solver", () => ({ solveAlg: vi.fn(async () => new Alg("")) }));
class Quaternion {
  x = 0; y = 0; z = 0; w = 1;
  set(x: number, y: number, z: number, w: number) { Object.assign(this, { x, y, z, w }); return this; }
  clone() { return new Quaternion().copy(this); }
  copy(q: Quat) { Object.assign(this, q); return this; }
  multiply(q: Quat) { return this.copy(multiply(this, q)); }
  slerp(q: Quat) { return this.copy(q); }
}
const quaternion = new Quaternion();
const scheduleRender = vi.fn();
vi.mock("cubing/twisty", () => ({ TwistyPlayer: class {
  remove = vi.fn(); experimentalAddMove = vi.fn();
  constructor(public options: Record<string, unknown>) { f.players.push(this); }
  experimentalCurrentThreeJSPuzzleObject() { return Promise.resolve({ quaternion }); }
  experimentalCurrentVantages() { return Promise.resolve([{ scheduleRender }].values()); }
} }));
const kpuzzle = await get3x3x3();
let cleanup: (() => void) | undefined;
let gyro: (q: Quat) => void, move: (move: string) => void, reset: (pattern: ReturnType<typeof kpuzzle.defaultPattern>) => void, referenceChanged: () => void;
let reference: Quat;
let frame: FrameRequestCallback;
const offs = Array.from({ length: 4 }, () => vi.fn());
beforeEach(() => {
  vi.clearAllMocks();
  f.effects = []; f.players = [];
  quaternion.set(0, 0, 0, 1);
  reference = { x: 0, y: 0, z: 0, w: 1 };
  f.controller = {
    pattern: kpuzzle.defaultPattern(), get gripReference() { return reference; },
    onGyro: (listener: typeof gyro) => { gyro = listener; return offs[0]; },
    onCubeMove: (listener: typeof move) => { move = listener; return offs[1]; },
    onPatternReset: (listener: typeof reset) => { reset = listener; return offs[2]; },
    onRecentreView: (listener: typeof referenceChanged) => { referenceChanged = listener; return offs[3]; },
  };
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });
async function mount() {
  GyroInset(); cleanup = f.effects[0]();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}
describe("GyroInset event presentation", () => {
  it("uses raw orientation relative to the shared reference without another render", async () => {
    await mount();
    const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    gyro(q); frame(0);
    expect(quaternion.y).toBeCloseTo(Math.SQRT1_2);
    expect(quaternion.w).toBeCloseTo(Math.SQRT1_2);
    reference = q; referenceChanged();
    expect(quaternion).toMatchObject({ x: 0, y: 0, z: 0, w: 1 });
    gyro(q); frame(1);
    expect(quaternion.w).toBeCloseTo(1);
    expect(scheduleRender.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(f.effects).toHaveLength(1); expect(f.players).toHaveLength(1);
    expect(f.players[0].options).toMatchObject({ backView: "none", experimentalDragInput: "none", controlPanel: "none" });
  });
  it("shares physical moves and pattern resets and disposes all subscriptions", async () => {
    await mount();
    move("R"); expect(f.players[0].experimentalAddMove).toHaveBeenLastCalledWith("R", { cancel: false });
    const pattern = kpuzzle.defaultPattern().applyMove("U"); reset(pattern);
    move("F");
    await Promise.resolve(); await Promise.resolve();
    expect(solveAlg).toHaveBeenLastCalledWith(pattern);
    expect(f.players[0].experimentalAddMove).toHaveBeenLastCalledWith("F", { cancel: false });
    cleanup?.(); cleanup = undefined;
    offs.forEach(off => expect(off).toHaveBeenCalledOnce());
    expect(f.players[0].remove).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
