import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { Controller } from "../state/controller";
import { deriveStatistics, type StatisticsSnapshot } from "../state/statistics";
import type { Solve } from "../state/types";
import { StatisticsView } from "./StatisticsView";
import { StatisticsRecords, StatisticsRankingTable, StatisticsAverageDetail } from "./StatisticsRecords";
import { StatisticsCaseTable, StatisticsF2lPerformance, PerformanceTable } from "./StatisticsAnalysisTables";
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
const clickEvent = () => ({ target: { closest: () => null } });
const keyEvent = (key: string) => { const target = {}; return { key, target, currentTarget: target, preventDefault: vi.fn() }; };

beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.dependencies = []; hooks.effects = []; vi.restoreAllMocks(); });

describe("Statistics user interactions", () => {
  it("opens the same solve from a ranking metric, solve-time button, row, and keyboard", () => {
    const onOpenSolve = vi.fn();
    const records = renderRoot(() => StatisticsRecords({ model, onOpenSolve }));
    const table = find(records, (element) => element.type === StatisticsRankingTable);
    const ranking = StatisticsRankingTable(table.props as Parameters<typeof StatisticsRankingTable>[0]);
    const row = find(ranking, (element) => element.type === "tr" && element.props.tabIndex === 0);
    const buttons = elements(row).filter((element) => element.type === "button");
    buttons[0].props.onClick(); buttons[1].props.onClick(); row.props.onClick(clickEvent());
    const enter = keyEvent("Enter"), space = keyEvent(" ");
    row.props.onKeyDown(enter); row.props.onKeyDown(space);
    expect(enter.preventDefault).toHaveBeenCalled(); expect(space.preventDefault).toHaveBeenCalled();
    expect(onOpenSolve).toHaveBeenCalledTimes(5);
    expect(onOpenSolve.mock.calls.every(([solve]) => solve === snapshot.solves[5])).toBe(true);
    // A button's click/keypress bubbles through the row without a second open.
    buttons[1].props.onClick();
    row.props.onClick({ target: { closest: () => ({ tagName: "BUTTON" }) } });
    row.props.onKeyDown({ ...keyEvent("Enter"), target: {} });
    expect(onOpenSolve).toHaveBeenCalledTimes(6);
  });

  it("opens a phase record from its distinct phase value or complete solve time", () => {
    const record = { ...model.records.single[0], value: 1210, totalTime: 11840 };
    const onOpen = vi.fn();
    const tree = renderRoot(() => StatisticsRankingTable({ model, metric: "cross", rows: [record], onOpen }));
    const row = find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0);
    const buttons = elements(row).filter((element) => element.type === "button");
    expect(buttons.map((button) => button.props.children)).toEqual(["1.21", "11.84"]);
    buttons[0].props.onClick(); buttons[1].props.onClick(); row.props.onClick(clickEvent());
    expect(onOpen.mock.calls.every(([opened]) => opened === record)).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

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
    const ranking = StatisticsRankingTable(table.props as Parameters<typeof StatisticsRankingTable>[0]);
    const row = find(ranking, (element) => element.type === "tr" && element.props.tabIndex === 0);
    row.props.onClick(clickEvent());
    expect(onOpenSolve).not.toHaveBeenCalled();
    tree = render();
    const average = find(tree, (element) => element.type === StatisticsAverageDetail);
    expect(average.props.window.entries.map((entry: { solveId: string }) => entry.solveId)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    const detail = StatisticsAverageDetail(average.props as Parameters<typeof StatisticsAverageDetail>[0]);
    find(detail, (element) => element.type === "button" && element.props.children === "19.00").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(snapshot.solves[1]);
    find(detail, (element) => element.type === "tr" && element.props.tabIndex === 0).props.onKeyDown(keyEvent(" "));
    expect(onOpenSolve).toHaveBeenCalledTimes(2);
  });

  it("opens a case's source solves and delegates Train case", () => {
    const rows = [{ caseId: "27", label: "27", count: 1, skipCount: 0, solveIds: ["s0"], samples: [], medianMs: 500 }, { caseId: "2", label: "2", count: 2, skipCount: 0, solveIds: ["s1"], samples: [], medianMs: 1000 }];
    const onOpenSolve = vi.fn(), onTrainCase = vi.fn();
    const render = () => renderRoot(() => StatisticsCaseTable({ family: "oll", rows, skipCount: 1, model, onOpenSolve, onTrainCase }));
    let tree = render();
    find(tree, (element) => element.type === PerformanceTable).props.onSelect(rows[0]);
    tree = render();
    find(tree, (element) => element.type === "button" && element.props.children === "Train case").props.onClick();
    expect(onTrainCase).toHaveBeenCalledWith("oll", "27");
    find(tree, (element) => element.type === "button" && element.props.children === "20.00").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(snapshot.solves[0]);
    find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0).props.onKeyDown(keyEvent("Enter"));
    expect(onOpenSolve).toHaveBeenCalledTimes(2);
    find(tree, (element) => element.type === "select" && element.props.value === "case").props.onChange({ target: { value: "median" } });
    expect(find(render(), (element) => element.type === PerformanceTable).props.rows[0].caseId).toBe("27");
  });

  it("expands an F2L position and opens its contributing solve from a row or solve time", () => {
    const onOpenSolve = vi.fn();
    const f2lModel = { ...model, analysisCount: 1, f2lPositions: model.f2lPositions.map((row, index) => index === 3 ? { ...row, count: 1, solveIds: ["s0"], samples: [{ solveId: "s0", timeMs: 1500, recognitionMs: 500, executionMs: 1000, moves: 6, tps: 6 }] } : row) };
    const render = () => renderRoot(() => StatisticsF2lPerformance({ model: f2lModel, onOpenSolve }));
    let tree = render();
    const performance = find(tree, (element) => element.type === PerformanceTable);
    const summary = PerformanceTable(performance.props as Parameters<typeof PerformanceTable>[0]);
    const fourth = elements(summary).filter((element) => element.type === "tr" && element.props.tabIndex === 0)[3];
    fourth.props.onKeyDown(keyEvent("Enter"));
    tree = render();
    expect(find(tree, (element) => element.props["aria-label"] === "F2L position solves")).toBeDefined();
    expect(elements(tree).filter((element) => element.type === "th").map((element) => element.props.children)).toEqual(["Pair time", "Recognition", "Execution", "STM", "Execution TPS", "Solve time", "Session", "Date"]);
    const source = find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0);
    expect(elements(source).filter((element) => element.type === "td").slice(0, 5).map((element) => element.props.children)).toEqual(["1.50", "0.50", "1.00", 6, "6.00"]);
    find(source, (element) => element.type === "button").props.onClick();
    source.props.onClick(clickEvent()); source.props.onKeyDown(keyEvent(" "));
    expect(onOpenSolve).toHaveBeenCalledTimes(3);
    expect(onOpenSolve).toHaveBeenLastCalledWith(snapshot.solves[0]);
  });

  it("opens singles, PBs, outliers, and DNFs from accessible chart points", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({ index: index + 1, id: `point${index}`, sessionId: "A", createdAt: index, time: index === 0 ? 1000000 : index === 24 ? null : 10000, isPb: index === 1, ao5: undefined, ao12: undefined }));
    const onOpenSolve = vi.fn();
    const tree = SolveTimeTrendChart({ points, scopeLabel: "All sessions", onOpenSolve });
    const interactive = elements(tree).filter((element) => element.type === "g" && element.props.role === "button");
    expect(interactive).toHaveLength(25);
    expect(interactive[0].props.className).toContain("outlier"); expect(interactive[1].props.className).toContain("pb");
    expect(interactive[24].props.className).toBe("chart-dnf");
    for (const index of [0, 1, 2, 24]) {
      expect(interactive[index].props.tabIndex).toBe(0);
      expect(interactive[index].props["aria-label"]).toContain("View solve");
      interactive[index].props.onClick(clickEvent()); interactive[index].props.onKeyDown(keyEvent("Enter")); interactive[index].props.onKeyDown(keyEvent(" "));
    }
    expect(onOpenSolve.mock.calls.flat()).toEqual(["point0", "point0", "point0", "point1", "point1", "point1", "point2", "point2", "point2", "point24", "point24", "point24"]);
    expect(elements(tree).filter((element) => element.type === "path" && element.props.className?.startsWith("chart-line")).every((element) => !element.props.onClick)).toBe(true);
  });

  it("loads through the Controller, keeps records beyond Chart window, and clears out-of-scope solve detail", async () => {
    const controller = new Controller(); hooks.controller = controller;
    controller.state.update((state) => ({ ...state, sessionId: "A" }));
    const select = vi.spyOn(controller, "selectSession");
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
    find(tree, (element) => element.type === SolveTimeTrendChart).props.onOpenSolve("s0");
    tree = render();
    expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solve).toBe(snapshot.solves[0]);
    expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solves).toEqual(history.solves);
    records.props.onOpenSolve(snapshot.solves[0]);
    tree = render(); expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solve.sessionId).toBe("B");
    const session = elements(tree).filter((element) => element.type === "select")[1];
    session.props.onChange({ target: { value: "A" } });
    tree = render(); for (const effect of hooks.effects) effect();
    expect(elements(tree).some((element) => element.type === StatisticsSolveDetail)).toBe(false);
    expect(onScopeChange).toHaveBeenLastCalledWith(history.solves.filter((solve) => solve.sessionId === "A").map((solve) => solve.id));
    expect(controller.state.get().sessionId).toBe("A");
    expect(select).not.toHaveBeenCalled();
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
