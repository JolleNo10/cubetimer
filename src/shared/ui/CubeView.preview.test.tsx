import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../app/Controller";
import { CubeModel } from "../../cube/model";
import { get3x3x3 } from "../../cube/puzzle";
import { patternToFacelets } from "../../cube/facelets";
import { IDENTITY } from "../../cube/orientation";
import { solveAlg } from "../../cube/solver";
import { CubeView } from "./CubeView";

// Run the existing effects with a tiny host/player seam, without WebGL or a
// browser. Dependency comparison preserves the explicit-reset contract.
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const fixture = vi.hoisted(() => ({
  controller: null as Controller | null, cursor: 0, slots: [] as Slot[], pending: [] as (() => void)[],
  host: { appendChild: vi.fn() },
  players: [] as { remove: ReturnType<typeof vi.fn>; experimentalAddMove: ReturnType<typeof vi.fn> }[],
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
  useState: (initial: unknown) => { fixture.cursor++; return [initial, () => {}]; },
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
  constructor() { fixture.players.push(this); }
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
});
afterEach(() => {
  fixture.slots.forEach(slot => slot?.cleanup?.());
  vi.restoreAllMocks();
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
