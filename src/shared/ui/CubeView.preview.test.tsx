import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alg } from "cubing/alg";
import type { GyroReferenceChangeReason } from "../../app/PhysicalCubeRuntime";
import { Controller } from "../../app/Controller";
import { CubeModel } from "../../cube/model";
import { get3x3x3 } from "../../cube/puzzle";
import { patternToFacelets } from "../../cube/facelets";
import { ALL_ORIENTATIONS, IDENTITY } from "../../cube/orientation";
import { solveAlg } from "../../cube/solver";
import { GyroInset } from "./GyroInset";
import { CubeView } from "./CubeView";

// Run the existing effects with a tiny host/player seam, without WebGL or a
// browser. Dependency comparison preserves the explicit-reset contract.
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const fixture = vi.hoisted(() => ({
  controller: null as Controller | null, cursor: 0, slots: [] as Slot[], pending: [] as (() => void)[],
  host: { appendChild: vi.fn() },
  players: [] as { options: Record<string, unknown>; alg?: unknown; experimentalSetupAlg?: { toString(): string }; remove: ReturnType<typeof vi.fn>; experimentalAddMove: ReturnType<typeof vi.fn> }[],
}));
function sameDependencies(left?: readonly unknown[], right?: readonly unknown[]) {
  return Boolean(left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i])));
}
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => {
    const index = fixture.cursor++;
    return (fixture.slots[index] ??= { value: { current: index === 0 ? fixture.host : initial } }).value;
  },
  useState: (initial: unknown) => {
    const index = fixture.cursor++, slot = fixture.slots[index] ??= { value: initial };
    return [slot.value, (value: unknown) => { slot.value = value; }];
  },
  useMemo: (make: () => unknown, deps: readonly unknown[]) => {
    const index = fixture.cursor++, previous = fixture.slots[index];
    if (!sameDependencies(previous?.deps, deps)) fixture.slots[index] = { value: make(), deps };
    return fixture.slots[index].value;
  },
  useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
    const index = fixture.cursor++, previous = fixture.slots[index];
    if (!sameDependencies(previous?.deps, deps)) {
      fixture.pending.push(() => {
        previous?.cleanup?.();
        fixture.slots[index] = { deps, cleanup: effect() };
      });
    }
  },
}));
vi.mock("../../app/useController", () => ({ useController: () => fixture.controller }));
vi.mock("cubing/twisty", () => ({ TwistyPlayer: class {
  remove = vi.fn(); experimentalAddMove = vi.fn();
  constructor(public options: Record<string, unknown>) { fixture.players.push(this); }
} }));
vi.mock("../../cube/solver", async () => {
  const { Alg } = await import("cubing/alg");
  return { solveAlg: vi.fn(async () => new Alg("")) };
});

const kpuzzle = await get3x3x3();
beforeEach(() => {
  fixture.cursor = 0; fixture.slots = []; fixture.pending = []; fixture.players = [];
  fixture.controller = new Controller(new CubeModel(kpuzzle));
  vi.clearAllMocks();
  vi.mocked(solveAlg).mockReset().mockResolvedValue(new Alg(""));
});
afterEach(() => {
  fixture.slots.forEach(slot => slot?.cleanup?.());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(displayFacelets: string, displayRevision: string, staticDisplay = true) {
  fixture.cursor = 0; fixture.pending = [];
  const controller = fixture.controller!;
  CubeView({
    settings: { ...controller.settings.get(), visualization: "3D" },
    facelets: controller.physical.state.get().cubeFacelets, gyroSupported: true,
    live: true, scramble: "", orientationOverride: IDENTITY,
    displayFacelets, displayRevision, staticDisplay,
  });
  fixture.pending.forEach(run => run());
  await Promise.resolve();
}

describe("CubeView hypothetical checkpoint display", () => {
  it("loads checkpoints on explicit revision changes without subscribing to live cube events", async () => {
    const controller = fixture.controller!;
    const moves = vi.spyOn(controller, "onCubeMove"), resets = vi.spyOn(controller, "onPatternReset"), grips = vi.spyOn(controller, "onGripChange");
    const first = patternToFacelets(kpuzzle.defaultPattern()), second = patternToFacelets(kpuzzle.defaultPattern().applyMove("R"));
    await render(first, "1:preview:0");
    expect(moves).not.toHaveBeenCalled();
    expect(resets).not.toHaveBeenCalled();
    expect(grips).not.toHaveBeenCalled();
    expect(patternToFacelets(vi.mocked(solveAlg).mock.calls[0][0])).toBe(first);
    await render(second, "1:preview:1");
    expect(fixture.players).toHaveLength(2);
    expect(fixture.players[0].remove).toHaveBeenCalledOnce();
    expect(patternToFacelets(vi.mocked(solveAlg).mock.calls[1][0])).toBe(second);
    controller.injectMove("U");
    fixture.players.forEach(player => expect(player.experimentalAddMove).not.toHaveBeenCalled());
    expect(resets).not.toHaveBeenCalled();
    await render(controller.physical.state.get().cubeFacelets, "1:live", false);
    expect(fixture.players).toHaveLength(3);
    expect(moves).toHaveBeenCalledOnce();
    expect(resets).toHaveBeenCalledOnce();
    controller.injectMove("R");
    expect(fixture.players[2].experimentalAddMove).toHaveBeenCalledOnce();
  });

  it("preserves incremental live rendering when only facelets change", async () => {
    const first = patternToFacelets(kpuzzle.defaultPattern()), second = patternToFacelets(kpuzzle.defaultPattern().applyMove("R"));
    await render(first, "2:live", false);
    await render(second, "2:live", false);
    expect(fixture.players).toHaveLength(1);
    expect(solveAlg).toHaveBeenCalledOnce();
    // The static flag is itself a reset boundary even with the same opaque key.
    await render(second, "2:live", true);
    expect(fixture.players).toHaveLength(2);
    expect(solveAlg).toHaveBeenCalledTimes(2);
  });
});

function renderLive(overrides: Partial<Parameters<typeof CubeView>[0]> = {}) {
  fixture.cursor = 0; fixture.pending = [];
  const controller = fixture.controller!;
  const tree = CubeView({ settings: { ...controller.settings.get(), visualization: "3D" },
    facelets: controller.physical.state.get().cubeFacelets, gyroSupported: true,
    live: true, scramble: "", showGyroInset: true, ...overrides });
  fixture.pending.forEach(run => run());
  return tree;
}
function findElement(tree: unknown, type: unknown): { props: Record<string, unknown> } | undefined {
  if (!tree || typeof tree !== "object") return;
  const element = tree as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return element as { props: Record<string, unknown> };
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type); if (found) return found;
  }
}
describe("Timer gyro presentation", () => {
  it("opts in only for live physical 3D state, independently of main stabilization", () => {
    const controller = fixture.controller!;
    expect(findElement(renderLive({ settings: { ...controller.settings.get(), visualization: "3D", useGyroscope: false } }), GyroInset)).toBeDefined();
    expect(fixture.players[0].options.backView).toBe("none");
    for (const overrides of [
      { showGyroInset: false }, { gyroSupported: false }, { live: false },
      { staticDisplay: true }, { displaySource: "virtual" as const },
      { displayFacelets: controller.physical.state.get().cubeFacelets },
      { settings: { ...controller.settings.get(), visualization: "2D" as const } },
      { settings: { ...controller.settings.get(), visualization: "3D" as const, showGyroView: false } },
    ]) expect(findElement(renderLive(overrides), GyroInset)).toBeUndefined();
  });
  it("rebuilds accumulated main grip rotations immediately on a reference notification", async () => {
    const controller = fixture.controller!;
    vi.spyOn(controller, "heldAs", "get").mockReturnValue(ALL_ORIENTATIONS.find(rotation => rotation.tokens.length > 0)!.orientation);
    const listeners: Array<(reason: GyroReferenceChangeReason) => void> = [];
    vi.spyOn(controller, "onGyroReferenceChange").mockImplementation(listener => { listeners.push(listener); return vi.fn(); });
    renderLive(); await Promise.resolve();
    controller.injectMove("R");
    const player = fixture.players[0];
    expect(player.experimentalSetupAlg?.toString()).not.toBe("");
    listeners.forEach(listener => listener("reset")); await Promise.resolve();
    expect(solveAlg).toHaveBeenLastCalledWith(controller.pattern);
    expect(player.alg).toBe("");
    expect(player.experimentalSetupAlg?.toString()).toBe("");
    controller.injectMove("U");
    expect(player.experimentalAddMove).toHaveBeenLastCalledWith("U", { cancel: false });
  });
});

it("disables Reset gyro in protected phases and reports only successful runtime resets", () => {
  const controller = fixture.controller!;
  vi.spyOn(controller, "gripReference", "get").mockReturnValue({ x: 0, y: 0, z: 0, w: 1 });
  const action = vi.spyOn(controller, "resetGyro").mockReturnValue(false);
  const button = findElement(renderLive({ gyroResetDisabled: true }), "button")!;
  expect(button.props.children).toBe("Reset gyro"); expect(button.props.disabled).toBe(true);
  const enabled = findElement(renderLive({ gyroResetDisabled: false }), "button")!;
  expect(enabled.props.disabled).toBe(false);
  (enabled.props.onClick as () => void)(); expect(action).toHaveBeenCalledOnce();
});

function deferredSetup() {
  let resolve!: (value: Alg) => void, reject!: (error: Error) => void;
  const promise = new Promise<Alg>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
function replacePattern() { fixture.controller!.physical.setModel(new CubeModel(kpuzzle)); }

it("makes reset feedback transient, replaces its timer and keeps scramble-lock silent", async () => {
  vi.useFakeTimers();
  const controller = fixture.controller!, listeners: Array<(reason: GyroReferenceChangeReason) => void> = [];
  vi.spyOn(controller, "gripReference", "get").mockReturnValue({ x: 0, y: 0, z: 0, w: 1 });
  vi.spyOn(controller, "onGyroReferenceChange").mockImplementation(listener => { listeners.push(listener); return () => {}; });
  const action = vi.spyOn(controller, "resetGyro").mockReturnValue(false);
  renderLive(); await settle();
  listeners.forEach(listener => listener("scramble-lock"));
  expect(JSON.stringify(renderLive())).not.toContain("Gyro orientation reset");
  const button = findElement(renderLive(), "button")!;
  (button.props.onClick as () => void)();
  expect(action).toHaveBeenCalledOnce();
  expect(JSON.stringify(renderLive())).toContain("Gyro reset unavailable");
  vi.advanceTimersByTime(1000);
  listeners.forEach(listener => listener("reset"));
  expect(JSON.stringify(renderLive())).toContain("Gyro orientation reset");
  vi.advanceTimersByTime(500);
  expect(JSON.stringify(renderLive())).toContain("Gyro orientation reset");
  vi.advanceTimersByTime(900);
  expect(JSON.stringify(renderLive())).not.toContain("Gyro orientation reset");
  (button.props.onClick as () => void)();
  vi.advanceTimersByTime(1400);
  expect(JSON.stringify(renderLive())).not.toContain("Gyro reset unavailable");
  listeners.forEach(listener => listener("reset"));
  fixture.slots.forEach(slot => { slot?.cleanup?.(); if (slot) slot.cleanup = undefined; });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])("keeps face and settled-grip moves visible while resync is pending (success=%s)", async success => {
  const controller = fixture.controller!;
  let grip!: (orientation: typeof IDENTITY) => void;
  vi.spyOn(controller, "onGripChange").mockImplementation(listener => { grip = listener; return () => {}; });
  renderLive(); await settle();
  const player = fixture.players[0], beforeSetup = player.experimentalSetupAlg, pending = deferredSetup();
  vi.mocked(solveAlg).mockReturnValueOnce(pending.promise);
  replacePattern();
  controller.injectMove("R");
  grip(ALL_ORIENTATIONS.find(rotation => rotation.tokens.length > 0)!.orientation);
  const immediateMoves = player.experimentalAddMove.mock.calls.map(call => call[0]);
  expect(immediateMoves[0]).toBe("R"); expect(immediateMoves.length).toBeGreaterThan(1);
  if (success) pending.resolve(new Alg("F")); else pending.reject(new Error("failed setup"));
  await settle();
  const allMoves = player.experimentalAddMove.mock.calls.map(call => call[0]);
  expect(allMoves).toEqual(success ? [...immediateMoves, ...immediateMoves] : immediateMoves);
  expect(player.experimentalSetupAlg?.toString()).toBe(success ? "F'" : beforeSetup?.toString());
});

it("lets only the newest async setup replace the player and ignores work after unmount", async () => {
  renderLive(); await settle();
  const older = deferredSetup(), newer = deferredSetup(), player = fixture.players[0];
  vi.mocked(solveAlg).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  replacePattern(); replacePattern();
  newer.resolve(new Alg("U")); await settle();
  older.resolve(new Alg("R")); await settle();
  expect(player.experimentalSetupAlg?.toString()).toBe("U'");
  const removed = deferredSetup(); vi.mocked(solveAlg).mockReturnValueOnce(removed.promise);
  replacePattern();
  fixture.slots.forEach(slot => { slot?.cleanup?.(); if (slot) slot.cleanup = undefined; });
  removed.resolve(new Alg("F")); await settle();
  expect(player.experimentalSetupAlg?.toString()).toBe("U'");
  expect(player.remove).toHaveBeenCalledOnce();
});

it("counts replayed post-snapshot moves toward main-view compaction", async () => {
  renderLive(); await settle();
  const pending = deferredSetup(); vi.mocked(solveAlg).mockReturnValueOnce(pending.promise);
  replacePattern();
  for (let i = 0; i < 400; i++) fixture.controller!.injectMove("R");
  expect(solveAlg).toHaveBeenCalledTimes(2);
  pending.resolve(new Alg("")); await settle();
  fixture.controller!.injectMove("R");
  expect(solveAlg).toHaveBeenCalledTimes(3);
  await settle();
});
