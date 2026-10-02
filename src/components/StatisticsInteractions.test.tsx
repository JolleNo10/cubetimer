import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { Controller } from "../state/controller";
import { deriveStatistics, type StatisticsSnapshot } from "../state/statistics";
import type { Solve } from "../state/types";
import { StatisticsView } from "./StatisticsView";
import { StatisticsRecords, StatisticsRankingTable, StatisticsAverageDetail } from "./StatisticsRecords";
import { StatisticsCaseTable, PerformanceTable } from "./StatisticsAnalysisTables";
import { StatisticsSolveDetail } from "./StatisticsSolveDetail";
import { ReplayDialog } from "./ReplayDialog";
import { AnalyticsDialog } from "./AnalyticsDialog";
import { SolveTimeTrendChart } from "./StatisticsCharts";

// Exercise presentation callback boundaries without a browser or a new DOM runner.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effectCursor: 0, dependencies: [] as (readonly unknown[] | undefined)[], effects: [] as (() => unknown)[], controller: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!Object.hasOwn(hooks.values, index)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next; }];
  },
  useMemo: (make: () => unknown) => make(), useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, dependencies?: readonly unknown[]) => {
    const index = hooks.effectCursor++, previous = hooks.dependencies[index];
    if (!dependencies || !previous || dependencies.some((value, at) => !Object.is(value, previous[at]))) hooks.effects.push(effect);
    hooks.dependencies[index] = dependencies;
  }, useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("../hooks/useController", () => ({ useController: () => hooks.controller, useAppState: () => (hooks.controller as Controller).state.get() }));

type Element = ReactElement<Record<string, any>>;
function renderRoot(make: () => ReactElement): Element { hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; return make() as Element; }
function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== "object" || !("props" in root)) return [];
  const element = root as Element;
  return [element, ...elements(element.props.children)];
}
function find(root: unknown, predicate: (element: Element) => boolean): Element {
  const found = elements(root).find(predicate); if (!found) throw new Error("Expected control missing"); return found;
}
const item = (id: string, sessionId: string, time: number, createdAt: number): Solve => ({ id, sessionId, rawMs: time, createdAt, penalty: "none", source: "keyboard", moves: [], scramble: "R U" });
const snapshot: StatisticsSnapshot = {
  sessions: [{ id: "A", name: "Timer Session", event: "333", createdAt: 1 }, { id: "B", name: "History Session", event: "333", createdAt: 2 }],
  solves: Array.from({ length: 6 }, (_, index) => item(`s${index}`, index % 2 ? "A" : "B", (20 - index) * 1000, index)),
};
const model = deriveStatistics(snapshot, { event: "333", sessionId: null }, "A");

beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.dependencies = []; hooks.effects = []; vi.restoreAllMocks(); });

describe("Statistics user interactions", () => {
  it("reverses rankings, resets default metric direction, and opens exact averages", () => {
    const onOpenSolve = vi.fn();
    const render = () => renderRoot(() => StatisticsRecords({ model, onOpenSolve }));
    let tree = render();
    let table = find(tree, (element) => element.type === StatisticsRankingTable);
    expect(table.props.rows.map((row: { value: number }) => row.value)).toEqual([15000, 16000, 17000, 18000, 19000, 20000]);
    const selects = elements(tree).filter((element) => element.type === "select");
    selects[1].props.onChange({ target: { value: "desc" } });
    tree = render(); table = find(tree, (element) => element.type === StatisticsRankingTable);
    expect(table.props.rows[0].value).toBe(20000);
    find(tree, (element) => element.type === "select" && element.props.value === "single").props.onChange({ target: { value: "ao5" } });
    tree = render(); table = find(tree, (element) => element.type === StatisticsRankingTable);
    expect(table.props.metric).toBe("ao5");
    expect(table.props.rows[0].value).toBe(17000);
    table.props.onOpen(table.props.rows[0]);
    tree = render();
    const average = find(tree, (element) => element.type === StatisticsAverageDetail);
    expect(average.props.window.entries.map((entry: { solveId: string }) => entry.solveId)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    const detail = StatisticsAverageDetail(average.props as Parameters<typeof StatisticsAverageDetail>[0]);
    find(detail, (element) => element.type === "button" && element.props.children === "19.00").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(snapshot.solves[1]);
  });

  it("opens a case's source solves and delegates Train case", () => {
    const rows = [{ caseId: "27", label: "27", count: 1, skipCount: 0, solveIds: ["s0"], medianMs: 500 }, { caseId: "2", label: "2", count: 2, skipCount: 0, solveIds: ["s1"], medianMs: 1000 }];
    const onOpenSolve = vi.fn(), onTrainCase = vi.fn();
    const render = () => renderRoot(() => StatisticsCaseTable({ family: "oll", rows, skipCount: 1, model, onOpenSolve, onTrainCase }));
    let tree = render();
    find(tree, (element) => element.type === PerformanceTable).props.onSelect(rows[0]);
    tree = render();
    find(tree, (element) => element.type === "button" && element.props.children === "Train case").props.onClick();
    expect(onTrainCase).toHaveBeenCalledWith("oll", "27");
    find(tree, (element) => element.type === "button" && element.props.children === "20.00").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(snapshot.solves[0]);
    find(tree, (element) => element.type === "select" && element.props.value === "case").props.onChange({ target: { value: "median" } });
    expect(find(render(), (element) => element.type === PerformanceTable).props.rows[0].caseId).toBe("27");
  });

  it("loads through the Controller, keeps records beyond Chart window, and clears out-of-scope solve detail", async () => {
    const controller = new Controller(); hooks.controller = controller;
    controller.state.update((state) => ({ ...state, sessionId: "A" }));
    const history = { ...snapshot, solves: [...snapshot.solves, ...Array.from({ length: 104 }, (_, index) => item(`extra${index}`, "A", 15000, index + 6))] };
    const load = vi.spyOn(controller, "loadStatisticsSnapshot").mockResolvedValue(history);
    const onScopeChange = vi.fn();
    const props = { currentEvent: "333" as const, activeSessionId: "A", onReplay: vi.fn(), onTools: vi.fn(), onTrainCase: vi.fn(), onScopeChange };
    const render = () => renderRoot(() => StatisticsView(props));
    render(); for (const effect of hooks.effects) effect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    let tree = render(); for (const effect of hooks.effects) effect();
    expect(load).toHaveBeenCalledOnce();
    const records = find(tree, (element) => element.type === StatisticsRecords);
    expect(records.props.model.records.single).toHaveLength(110);
    elements(tree).filter((element) => element.type === "select")[2].props.onChange({ target: { value: "50" } });
    tree = render();
    expect(find(tree, (element) => element.type === SolveTimeTrendChart).props.points).toHaveLength(50);
    expect(find(tree, (element) => element.type === StatisticsRecords).props.model.records.single).toHaveLength(110);
    records.props.onOpenSolve(snapshot.solves[0]);
    tree = render(); expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solve.sessionId).toBe("B");
    const session = elements(tree).filter((element) => element.type === "select")[1];
    session.props.onChange({ target: { value: "A" } });
    tree = render(); for (const effect of hooks.effects) effect();
    expect(elements(tree).some((element) => element.type === StatisticsSolveDetail)).toBe(false);
    expect(onScopeChange).toHaveBeenLastCalledWith(history.solves.filter((solve) => solve.sessionId === "A").map((solve) => solve.id));
    expect(controller.state.get().sessionId).toBe("A");
  });

  it("passes cross-Session Solve objects to global Replay/Tools and disables Replay training", () => {
    const controller = new Controller(); hooks.controller = controller;
    controller.state.update((state) => ({ ...state, ready: true, area: "statistics", sessionId: "A", sessions: snapshot.sessions, solves: [snapshot.solves[1]] }));
    const select = vi.spyOn(controller, "selectSession");
    const render = () => renderRoot(() => App());
    let tree = render();
    const statistics = find(tree, (element) => element.type === StatisticsView);
    statistics.props.onReplay(snapshot.solves[0]); statistics.props.onTools(snapshot.solves[0]);
    tree = render();
    const replay = find(tree, (element) => element.type === ReplayDialog);
    expect(replay.props.solve).toBe(snapshot.solves[0]);
    expect(replay.props.onTrainStep).toBeUndefined();
    expect(find(tree, (element) => element.type === AnalyticsDialog).props.solve).toBe(snapshot.solves[0]);
    expect(controller.state.get().sessionId).toBe("A"); expect(select).not.toHaveBeenCalled();
    find(tree, (element) => element.type === StatisticsView).props.onScopeChange(["s1"]);
    tree = render();
    expect(elements(tree).some((element) => element.type === ReplayDialog || element.type === AnalyticsDialog)).toBe(false);
  });
});
