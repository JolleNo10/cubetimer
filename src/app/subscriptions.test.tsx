import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CubeModel } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import { App } from "./App";
import { Controller } from "./Controller";
import { Training } from "../features/training/components/Training";

// A notification/render fixture, following the existing presentation hook tests.
// It evaluates real component trees and snapshot identity without a DOM or effects.
type Surface = { render: () => void; children: Surface[]; cleanups: (() => void)[] };
const hooks = vi.hoisted(() => ({ controller: null as unknown, surface: null as Surface | null, dirty: new Set<Surface>() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useContext: () => hooks.controller,
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
  useMemo: (make: () => unknown) => make(), useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => {
    const surface = hooks.surface!;
    let previous = snapshot();
    surface.cleanups.push(subscribe(() => {
      const current = snapshot();
      if (!Object.is(current, previous)) { previous = current; hooks.dirty.add(surface); }
    }));
    return previous;
  },
}));
vi.mock("../shared/ui/CubeView", () => ({ CubeView: () => <div /> }));

const kpuzzle = await get3x3x3();
let unmount = () => {};
beforeEach(() => { vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn()); });
afterEach(() => { unmount(); hooks.dirty.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function renderFixture(controller: Controller, element: ReactElement) {
  hooks.controller = controller;
  const counts = new Map<string, number>();
  function dispose(surface: Surface) {
    hooks.dirty.delete(surface);
    surface.cleanups.forEach(cleanup => cleanup());
    surface.children.forEach(dispose);
  }
  function visit(value: unknown, parent: Surface) {
    if (Array.isArray(value)) { value.forEach(item => visit(item, parent)); return; }
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const element = value as ReactElement<Record<string, unknown>>;
    const rawType: unknown = element.type;
    const type = typeof rawType === "object" && rawType !== null && "type" in rawType ? rawType.type : rawType;
    if (typeof type !== "function") { visit(element.props.children, parent); return; }
    const surface: Surface = { children: [], cleanups: [], render: () => {
      surface.children.forEach(dispose); surface.children = [];
      surface.cleanups.forEach(cleanup => cleanup()); surface.cleanups = [];
      hooks.surface = surface;
      counts.set(type.name, (counts.get(type.name) ?? 0) + 1);
      visit(type(element.props), surface);
    } };
    parent.children.push(surface); surface.render();
  }
  const root: Surface = { render: () => {}, children: [], cleanups: [] };
  visit(element, root); unmount = () => dispose(root);
  return {
    count: (name: string) => counts.get(name) ?? 0,
    flush: () => { while (hooks.dirty.size) { const surface = hooks.dirty.values().next().value!; hooks.dirty.delete(surface); surface.render(); } },
  };
}

describe("presentation subscription locality", () => {
  it("updates Timer surfaces without rerendering history and statistics on a physical turn", () => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.state.update(state => ({ ...state, ready: true }));
    controller.setVirtualCube(true); controller.setScramble("R U");
    const view = renderFixture(controller, <App />);
    const before = [view.count("SolveList"), view.count("StatsPanel"), view.count("ConnectionPanel")];
    expect(before.every(count => count > 0)).toBe(true);
    const progress = view.count("ScramblePanel"), cube = view.count("CubeView");
    controller.injectMove("R"); view.flush();
    expect([view.count("SolveList"), view.count("StatsPanel"), view.count("ConnectionPanel")]).toEqual(before);
    expect(view.count("ScramblePanel")).toBeGreaterThan(progress);
    expect(view.count("CubeView")).toBeGreaterThan(cube);
    controller.physical.state.update(state => ({ ...state, battery: 42 })); view.flush();
    expect(view.count("ConnectionPanel")).toBeGreaterThan(before[2]);
    expect([view.count("SolveList"), view.count("StatsPanel")]).toEqual(before.slice(0, 2));
    controller.sessions.update(state => ({ ...state, solves: [...state.solves] })); view.flush();
    expect(view.count("SolveList")).toBeGreaterThan(before[0]);
    expect(view.count("StatsPanel")).toBeGreaterThan(before[1]);
  });

  it.each(["f2l", "oll", "pll"] as const)("keeps the %s library isolated while Training setup and cube update", async family => {
    const controller = new Controller(new CubeModel(kpuzzle));
    controller.setVirtualCube(true); controller.setArea("training"); controller.setTrainingFamily(family);
    await controller.setTrainingMode("virtual");
    if (family === "f2l") await controller.selectF2lCase("F2L 1");
    else await controller.selectLastLayerCase(family, family === "oll" ? "27" : "T");
    const view = renderFixture(controller, <Training />);
    const library = family === "f2l" ? "F2lLibraryPanel" : "LastLayerCaseLibrary";
    const before = view.count(library), setup = view.count("TrainingSetupPanel"), cube = view.count("CubeView");
    expect(before).toBeGreaterThan(0);
    controller.injectMove("R"); view.flush();
    expect(view.count(library)).toBe(before);
    expect(view.count("TrainingSetupPanel")).toBeGreaterThan(setup);
    expect(view.count("CubeView")).toBeGreaterThan(cube);
    controller.physical.state.update(state => ({ ...state, battery: 42 }));
    controller.elapsed.set(100); view.flush();
    expect(view.count(library)).toBe(before);
  });
});
