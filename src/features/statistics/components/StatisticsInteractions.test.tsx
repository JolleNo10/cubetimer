import { renderToStaticMarkup } from "react-dom/server";
import { get3x3x3 } from "../../../cube/puzzle";
import { buildLastLayerCatalogueTarget } from "../../../cube/lastLayerTraining";
import { getLastLayerThumbnailModel } from "../../../cube/lastLayerThumbnail";
import { LastLayerCaseThumbnail } from "../../../shared/ui/LastLayerCaseThumbnail";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as puzzleLoading from "../../../cube/puzzle";
import { StatsPanel, Stat } from "./StatsPanel";
import { Header } from "../../../app/components/Header";
import { SolveAnalysisReview } from "../../history/components/SolveAnalysisReview";
import { SolveActions } from "../../history/components/SolveActions";
import { focusCases } from "../state/statistics";
import { App } from "../../../app/App";
import { CubeModel } from "../../../cube/model";
import { Controller } from "../../../app/Controller";
import { deriveStatistics, type StatisticsSnapshot } from "../state/statistics";
import type { Solve } from "../../../app/types";
import { StatisticsView, StatisticsNavigation, StatisticsOverview, StatisticsOverviewSummary, SessionTable, type StatisticsSubview } from "./StatisticsView";
import { Pagination, StatCard, StatsSection } from "./StatisticsPrimitives";
import { StatisticsRecords, StatisticsRankingTable, StatisticsAverageDetail, StatisticsCfopRecords } from "./StatisticsRecords";
import { analyseSolve } from "../../../cube/analysis";
import { useResultHistory } from "../../history/components/resultCharts/useResultHistory";
import { StatisticsAnalysisTables, StatisticsCaseDiagram, StatisticsCaseTable, StatisticsF2lPerformance, StatisticsF2lPerformancePanel, PerformanceTable, SortHeader } from "./StatisticsAnalysisTables";
import { StatisticsSolveDetail } from "./StatisticsSolveDetail";
import { SolveReviewDialog } from "../../history/components/SolveReviewDialog";
import { AverageProgressionChart, SolveTimeTrendChart } from "./StatisticsCharts";

// Exercise presentation callback boundaries without a browser or a new DOM runner.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effectCursor: 0, dependencies: [] as (readonly unknown[] | undefined)[], effects: [] as (() => unknown)[], controller: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useContext: () => hooks.controller,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++, values = hooks.values;
    if (!Object.hasOwn(values, index)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
  },
  useMemo: (make: () => unknown) => make(), useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, dependencies?: readonly unknown[]) => {
    const index = hooks.effectCursor++, previous = hooks.dependencies[index];
    if (!dependencies || !previous || dependencies.some((value, at) => !Object.is(value, previous[at]))) hooks.effects.push(effect);
    hooks.dependencies[index] = dependencies;
  }, useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("../../../app/useController", async original => ({
  ...await original<typeof import("../../../app/useController")>(),
  useController: () => hooks.controller,
  useAppState: () => (hooks.controller as Controller).state.get(),
  useSessionState: () => (hooks.controller as Controller).sessions.get(),
  useSettings: () => (hooks.controller as Controller).settings.get(),
}));

type Element = ReactElement<Record<string, any>>;
function renderRoot(make: () => ReactElement): Element { hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; return make() as Element; }
function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== "object" || !("props" in root)) return [];
  const element = root as Element;
  // Element-valued props (such as section actions) are part of the rendered tree too.
  const slotted = Object.entries(element.props).filter(([key, value]) => key !== "children" && value && typeof value === "object" && "props" in value).map(([, value]) => value);
  return [element, ...elements(element.props.children), ...elements(slotted)];
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
  it("opens the exact solve from its time button, whole row and keyboard", () => {
    const onOpenSolve = vi.fn();
    const tree = renderRoot(() => StatisticsRecords({ model, onOpenSolve }));
    const row = find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0);
    const button = find(row, (element) => element.type === "button");
    button.props.onClick(); row.props.onClick(clickEvent());
    const enter = keyEvent("Enter"), space = keyEvent(" ");
    row.props.onKeyDown(enter); row.props.onKeyDown(space);
    expect(enter.preventDefault).toHaveBeenCalled(); expect(space.preventDefault).toHaveBeenCalled();
    expect(onOpenSolve).toHaveBeenCalledTimes(4);
    expect(onOpenSolve.mock.calls.every(([solve]) => solve === snapshot.solves[5])).toBe(true);
    button.props.onClick();
    row.props.onClick({ target: { closest: () => ({ tagName: "BUTTON" }) } });
    row.props.onKeyDown({ ...keyEvent("Enter"), target: {} });
    expect(onOpenSolve).toHaveBeenCalledTimes(5);
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

  it("sorts solve columns both ways and opens exact average cells without opening the solve", () => {
    const local = deriveStatistics({ ...snapshot, solves: snapshot.solves.map((solve) => ({ ...solve, sessionId: "A" })) }, { event: "333", sessionId: null }, "A");
    const onOpenSolve = vi.fn();
    const render = () => renderRoot(() => StatisticsRecords({ model: local, onOpenSolve }));
    let tree = render();
    const firstRow = () => find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0);
    expect(firstRow().props["aria-label"]).toContain("15.00");
    const sort = (name: string) => find(tree, (element) => element.type === "th" && elements(element).some((child) => child.type === "button" && child.props.children[0] === name));
    find(sort("Time"), (element) => element.type === "button").props.onClick();
    tree = render(); expect(firstRow().props["aria-label"]).toContain("20.00");
    find(sort("Ao5"), (element) => element.type === "button").props.onClick();
    tree = render(); expect(firstRow().props["aria-label"]).toContain("15.00");
    const row = firstRow();
    const cell = find(row, (element) => element.type === "button" && element.props["aria-label"] === "View Ao5 window ending at s5");
    const event = { stopPropagation: vi.fn() };
    cell.props.onClick(event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    row.props.onClick({ target: { closest: () => ({ tagName: "BUTTON" }) } });
    row.props.onKeyDown({ ...keyEvent("Enter"), target: {} });
    expect(onOpenSolve).not.toHaveBeenCalled();
    tree = render();
    const average = find(tree, (element) => element.type === StatisticsAverageDetail);
    expect(average.props.window.entries.map((entry: { solveId: string }) => entry.solveId)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(average.props.window).toBe(local.solveRows[5].averages.ao5);
    const detail = StatisticsAverageDetail(average.props as Parameters<typeof StatisticsAverageDetail>[0]);
    find(detail, (element) => element.type === "button" && element.props.children === "19.00").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(local.scopeSolves[1]);
    find(detail, (element) => element.type === "tr" && element.props.tabIndex === 0).props.onKeyDown(keyEvent(" "));
    expect(onOpenSolve).toHaveBeenCalledTimes(2);
  });

  it.each(["Time", "Ao5", "Ao12", "Ao50", "Ao100", "TPS", "STM", "Cross", "F2L", "OLL", "PLL", "Session", "Date"])("toggles sorting for %s", (name) => {
    const render = () => renderRoot(() => StatisticsRecords({ model, onOpenSolve: vi.fn() }));
    let tree = render();
    const header = () => find(tree, (element) => element.type === "th" && elements(element).some((child) => child.type === "button" && child.props.children[0] === name));
    find(header(), (element) => element.type === "button").props.onClick(); tree = render();
    expect(header().props["aria-sort"]).toBe(name === "Time" ? "descending" : "ascending");
    find(header(), (element) => element.type === "button").props.onClick(); tree = render();
    expect(header().props["aria-sort"]).toBe(name === "Time" ? "ascending" : "descending");
  });

  it("opens PB average windows and clears an average detail when scope excludes its members", () => {
    const local = deriveStatistics({ ...snapshot, solves: snapshot.solves.map((solve) => ({ ...solve, sessionId: "A" })) }, { event: "333", sessionId: null }, "A");
    const onOpenSolve = vi.fn();
    let currentModel = local;
    const render = () => renderRoot(() => StatisticsRecords({ model: currentModel, onOpenSolve }));
    let tree = render();
    find(tree, (element) => element.type === "select").props.onChange({ target: { value: "ao5" } });
    tree = render();
    const pbSelect = find(tree, (element) => element.type === "select");
    expect(pbSelect.props.value).toBe("ao5");
    const pb = find(tree, (element) => element.type === StatsSection && element.props.id === "pb-history");
    const row = find(pb, (element) => element.type === "tr" && element.props.tabIndex === 0);
    row.props.onKeyDown(keyEvent("Enter"));
    tree = render();
    expect(find(tree, (element) => element.type === StatisticsAverageDetail).props.window).toBe(local.pbHistory.ao5[0].kind === "average" ? local.pbHistory.ao5[0].window : undefined);
    expect(onOpenSolve).not.toHaveBeenCalled();
    currentModel = model;
    expect(elements(render()).some((element) => element.type === StatisticsAverageDetail)).toBe(false);
    currentModel = deriveStatistics(snapshot, { event: "333", sessionId: "B" }, "A");
    expect(elements(render()).some((element) => element.type === StatisticsAverageDetail)).toBe(false);
  });

  it("bounds solve-table rendering and resets pagination when sorting", () => {
    const large = deriveStatistics({ ...snapshot, solves: Array.from({ length: 110 }, (_, index) => item(`s${index}`, "A", 10000 + index * 100, index)) }, { event: "333", sessionId: null }, "A");
    const render = () => renderRoot(() => StatisticsRecords({ model: large, onOpenSolve: vi.fn() }));
    let tree = render();
    const section = () => find(tree, (element) => element.type === StatsSection && element.props.id === "solves");
    const rows = () => elements(section()).filter((element) => element.type === "tr" && element.props.tabIndex === 0);
    expect(rows()).toHaveLength(50);
    find(tree, (element) => element.type === Pagination).props.onPageChange(1);
    tree = render(); expect(rows()[0].props["aria-label"]).toContain("15.00");
    find(tree, (element) => element.type === "button" && element.props.className === "stats-sort").props.onClick();
    tree = render(); expect(rows()[0].props["aria-label"]).toContain("20.90");
  });

  it.each(["oll", "pll"] as const)("opens %s source solves and delegates Train case", (family) => {
    const rows = [{ caseId: "27", label: "27", count: 1, skipCount: 0, solveIds: ["s0"], samples: [], medianMs: 500 }, { caseId: "2", label: "2", count: 2, skipCount: 0, solveIds: ["s1"], samples: [], medianMs: 1000 }];
    const onOpenSolve = vi.fn(), onTrainCase = vi.fn();
    const render = () => renderRoot(() => StatisticsCaseTable({ family, rows, skipCount: 1, model, onOpenSolve, onTrainCase }));
    let tree = render();
    find(tree, (element) => element.type === PerformanceTable).props.onSelect(rows[0]);
    tree = render();
    find(tree, (element) => element.type === "button" && element.props.children === "Train case").props.onClick();
    expect(onTrainCase).toHaveBeenCalledWith(family, "27");
    find(tree, (element) => element.type === "button" && element.props.children === "20.00").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(snapshot.solves[0]);
    find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0).props.onKeyDown(keyEvent("Enter"));
    expect(onOpenSolve).toHaveBeenCalledTimes(2);
    expect(elements(tree).some((element) => element.type === "select")).toBe(false);
    const table = () => find(render(), (element) => element.type === PerformanceTable);
    expect(table().props.rows.map((row: { caseId: string }) => row.caseId)).toEqual(["2", "27"]);
    table().props.sort.onSort("median");
    expect(table().props.sort).toMatchObject({ column: "median", direction: "asc" });
    expect(table().props.rows[0].caseId).toBe("27");
    table().props.sort.onSort("median");
    expect(table().props.sort.direction).toBe("desc");
    expect(table().props.rows[0].caseId).toBe("2");
    table().props.sort.onSort("case");
    expect(table().props.sort).toMatchObject({ column: "case", direction: "asc" });
    const header = PerformanceTable(table().props as Parameters<typeof PerformanceTable>[0]);
    expect(elements(header).filter((element) => element.type === SortHeader).map((element) => element.props.label)).toEqual(["Case", "Samples", "Best", "Median", "Measured recognition median", "Measured execution median", "STM median", "Execution TPS", "Skips"]);
  });

  it.each(["slot", "order"] as const)("expands F2L %s and opens its source solve by button, click, or keyboard", mode => {
    const onOpenSolve = vi.fn();
    const f2lModel = { ...model, analysisCount: 1, f2lSlots: model.f2lSlots.map((row, index) => index === 3 ? { ...row, count: 1, solveIds: ["s0"], samples: [{ solveId: "s0", timeMs: 1500, recognitionMs: 500, executionMs: 1000, moves: 6, tps: 6 }] } : row) };
    f2lModel.f2lPositions = f2lModel.f2lPositions.map((row, index) => ({ ...row, count: f2lModel.f2lSlots[index].count, samples: f2lModel.f2lSlots[index].samples }));
    const render = () => renderRoot(() => StatisticsF2lPerformancePanel({ model: f2lModel, onOpenSolve, mode }));
    let tree = render();
    const performance = find(tree, (element) => element.type === PerformanceTable);
    expect(find(tree, (element) => element.type === "p" && element.props.children === (mode === "slot" ? "Where each pair went in relative to how you held the cube, after any rotations" : "Pair completion order · skipped/XCross pairs counted separately"))).toBeDefined();
    const summary = PerformanceTable(performance.props as Parameters<typeof PerformanceTable>[0]);
    const fourth = elements(summary).filter((element) => element.type === "tr" && element.props.tabIndex === 0)[3];
    fourth.props.onKeyDown(keyEvent("Enter"));
    tree = render();
    expect(find(tree, (element) => element.props["aria-label"] === (mode === "slot" ? "F2L insertion position solves" : "F2L solve order solves"))).toBeDefined();
    expect(elements(tree).filter((element) => element.type === "th").map((element) => element.props.children)).toEqual(["Pair time", "Measured recognition", "Measured execution", "STM", "Execution TPS", "Solve time", "Session", "Date"]);
    const source = find(tree, (element) => element.type === "tr" && element.props.tabIndex === 0);
    expect(elements(source).filter((element) => element.type === "td").slice(0, 5).map((element) => element.props.children)).toEqual(["1.50", "0.50", "1.00", 6, "6.00"]);
    find(source, (element) => element.type === "button").props.onClick();
    source.props.onClick(clickEvent()); source.props.onKeyDown(keyEvent(" "));
    expect(onOpenSolve).toHaveBeenCalledTimes(3);
    expect(onOpenSolve).toHaveBeenLastCalledWith(snapshot.solves[0]);
    expect(elements(tree).some(element => element.type === "h3" && Array.isArray(element.props.children) && element.props.children[0] === (mode === "slot" ? "BL" : "4th pair"))).toBe(true);

  });

  it("opens singles, PBs, outliers, and DNFs from accessible chart points", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({ index: index + 1, id: `point${index}`, sessionId: "A", createdAt: index, time: index === 0 ? 1000000 : index === 2 ? 100 : index === 24 ? null : 10000, isPb: index === 1, ao5: undefined, ao12: undefined }));
    const onOpenSolve = vi.fn();
    const tree = SolveTimeTrendChart({ points, scopeLabel: "All sessions", onOpenSolve });
    const interactive = elements(tree).filter((element) => element.type === "g" && element.props.role === "button");
    expect(interactive).toHaveLength(25);
    expect(interactive[0].props.className).toContain("outlier"); expect(interactive[1].props.className).toContain("pb");
    expect(interactive[2].props.className).toContain("outlier-low");
    expect(interactive[2].props["aria-label"]).toContain("View solve 0.10");
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
    controller.state.update((state) => ({ ...state, area: "statistics" }));
controller.sessions.update((state) => ({ ...state, sessionId: "A" }));
    const select = vi.spyOn(controller, "selectSession");
    const history: StatisticsSnapshot = { sessions: [...snapshot.sessions, { id: "C", name: "2x2", event: "222", createdAt: 3 }], solves: [...snapshot.solves, ...Array.from({ length: 104 }, (_, index) => item(`extra${index}`, "A", 15000, index + 6)), item("other-event", "C", 1000, 120)] };
    const load = vi.spyOn(controller, "loadStatisticsSnapshot").mockResolvedValue(history);
    const onScopeChange = vi.fn();
    const props = { currentEvent: "333" as const, activeSessionId: "A", view: "Overview" as StatisticsSubview, onViewChange: (view: StatisticsSubview) => { props.view = view; }, onReplay: vi.fn(), onSolveAgain: vi.fn(), onTrainCase: vi.fn(), onScopeChange };
    const render = () => renderRoot(() => StatisticsView(props));
    render(); for (const effect of hooks.effects) effect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    let tree = render(); for (const effect of hooks.effects) effect();
    expect(load).toHaveBeenCalledOnce();
    expect(elements(tree).some((element) => element.type === StatisticsRecords)).toBe(false);
    expect(find(tree, (element) => element.type === StatisticsOverview).props.series.trend).toHaveLength(100);
    find(tree, (element) => element.type === StatisticsOverview).props.onChartWindowChange(50);
    tree = render();
    expect(find(tree, (element) => element.type === StatisticsOverview).props.series.trend).toHaveLength(50);
    expect(find(tree, (element) => element.type === StatisticsOverview).props.model.solveRows).toHaveLength(110);
    find(tree, (element) => element.type === StatisticsOverview).props.onOpenSolveId("s0");
    tree = render();
    expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solve).toBe(snapshot.solves[0]);
    expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solves).toEqual(history.solves.filter((solve) => solve.sessionId !== "C"));
    find(tree, (element) => element.type === StatisticsNavigation).props.onSelect("Solves");
    tree = render();
    const records = find(tree, (element) => element.type === StatisticsRecords);
    expect(records.props.model.solveRows).toHaveLength(110);
    expect(elements(tree).filter((element) => element.type === "select")).toHaveLength(2);
    for (const view of ["CFOP", "Cases", "Overview", "Solves"]) {
      find(tree, (element) => element.type === StatisticsNavigation).props.onSelect(view);
      tree = render();
    }
    expect(load).toHaveBeenCalledOnce();
    expect(controller.snapshot().area).toBe("statistics");
    records.props.onOpenSolve(snapshot.solves[0]);
    tree = render(); expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solve.sessionId).toBe("B");
    const session = elements(tree).filter((element) => element.type === "select")[1];
    session.props.onChange({ target: { value: "A" } });
    tree = render(); for (const effect of hooks.effects) effect();
    expect(elements(tree).some((element) => element.type === StatisticsSolveDetail)).toBe(false);
    expect(onScopeChange).toHaveBeenLastCalledWith(history.solves.filter((solve) => solve.sessionId === "A").map((solve) => solve.id));
    expect(controller.snapshot().sessionId).toBe("A");
    expect(select).not.toHaveBeenCalled();
    find(tree, (element) => element.type === StatisticsRecords).props.onOpenSolve(snapshot.solves[1]);
    tree = render(); expect(find(tree, (element) => element.type === StatisticsSolveDetail).props.solve.id).toBe("s1");
    elements(tree).filter((element) => element.type === "select")[0].props.onChange({ target: { value: "222" } });
    tree = render(); for (const effect of hooks.effects) effect();
    expect(elements(tree).some((element) => element.type === StatisticsSolveDetail)).toBe(false);
    expect(onScopeChange).toHaveBeenLastCalledWith(["other-event"]);
    expect(controller.snapshot().sessionId).toBe("A"); expect(load).toHaveBeenCalledOnce();
  });

  it("passes cross-Session Solve objects to the global Review and disables its training", () => {
    const controller = new Controller(); hooks.controller = controller;
    controller.state.update((state) => ({ ...state, ready: true, area: "statistics" }));
controller.sessions.update((state) => ({ ...state, sessionId: "A", sessions: snapshot.sessions, solves: [snapshot.solves[1]] }));
    const select = vi.spyOn(controller, "selectSession");
    const render = () => renderRoot(() => App());
    let tree = render();
    const statistics = find(tree, (element) => element.type === StatisticsView);
    statistics.props.onReplay(snapshot.solves[0]);
    tree = render();
    const replay = find(tree, (element) => element.type === SolveReviewDialog);
    expect(replay.props.solve).toBe(snapshot.solves[0]);
    expect(replay.props.onTrainStep).toBeUndefined();
    expect(controller.snapshot().sessionId).toBe("A"); expect(select).not.toHaveBeenCalled();
    find(tree, (element) => element.type === StatisticsView).props.onScopeChange(["s1"]);
    tree = render();
    expect(elements(tree).some((element) => element.type === SolveReviewDialog)).toBe(false);
  });

  it("filters Statistics from a Session row by click or keyboard", () => {
    const onSelect = vi.fn();
    const tree = renderRoot(() => SessionTable({ model, onSelect }));
    const rows = elements(tree).filter((element) => element.type === "tr" && element.props.tabIndex === 0);
    expect(rows.map((row) => row.props["aria-label"])).toEqual(["Show statistics for Timer Session", "Show statistics for History Session"]);
    rows[1].props.onClick(clickEvent()); rows[1].props.onKeyDown(keyEvent("Enter")); rows[0].props.onKeyDown(keyEvent(" "));
    expect(onSelect.mock.calls.flat()).toEqual(["B", "B", "A"]);
  });

  it("previews chart points on hover/focus and opens any series point", () => {
    const points = Array.from({ length: 6 }, (_, index) => ({ index, solveId: `s${index}`, sessionId: "A", createdAt: index, segmentKey: "0", ao5: index > 3 ? 15000 : undefined }));
    const onOpenSolve = vi.fn();
    // AverageProgressionChart delegates to the shared time-series chart; render that element's own tree.
    const chart = AverageProgressionChart({ points, scopeLabel: "A", onOpenSolve }) as Element;
    const render = () => renderRoot(() => (chart.type as (props: unknown) => Element)(chart.props));
    let tree = render();
    const target = () => find(tree, (element) => element.type === "g" && element.props["data-solve-id"] === "s4");
    expect(target().props.role).toBe("button");
    target().props.onFocus();
    tree = render();
    const frame = find(tree, (element) => typeof element.type === "function" && element.props.tooltip !== undefined);
    expect(frame.props.tooltip.rows.find((row: { label: string }) => row.label === "Ao5").value).toBe("15.00");
    target().props.onKeyDown(keyEvent("Enter"));
    expect(onOpenSolve).toHaveBeenCalledWith("s4");
    target().props.onBlur();
    tree = render();
    expect(find(tree, (element) => typeof element.type === "function" && element.props.tooltip !== undefined).props.tooltip).toBeNull();
  });

  it("opens Solves-tab personal bests as solves or exact average windows", () => {
    const local = deriveStatistics({ ...snapshot, solves: snapshot.solves.map((solve) => ({ ...solve, sessionId: "A" })) }, { event: "333", sessionId: null }, "A");
    const onOpenSolve = vi.fn();
    const records = renderRoot(() => StatisticsRecords({ model: local, onOpenSolve }));
    const summary = find(records, (element) => typeof element.type === "function" && element.props.onOpenAverage !== undefined);
    const cards = renderRoot(() => (summary.type as (props: unknown) => Element)(summary.props));
    const statCards = elements(cards).filter((element) => element.type === StatCard);
    expect(statCards.map((card) => card.props.label)).toEqual(["Best single", "Best Ao5", "Best Ao12", "Best Ao50", "Best Ao100"]);
    statCards[0].props.onOpen();
    expect(onOpenSolve).toHaveBeenCalledWith(local.scopeSolves[5]);
    statCards[1].props.onOpen();
    const tree = renderRoot(() => StatisticsRecords({ model: local, onOpenSolve }));
    expect(find(tree, (element) => element.type === StatisticsAverageDetail).props.window).toBe(local.records.ao5[0].kind === "average" ? local.records.ao5[0].window : undefined);
    expect(statCards[4].props.onOpen).toBeUndefined();
  });

  it.each([["oll", "27"], ["pll", "T"]] as const)("trains or reviews a suggested slow %s case", (family, caseId) => {
    const rows = [{ caseId, label: caseId, count: 4, skipCount: 0, solveIds: ["s0"], samples: [], medianMs: 2000 }];
    const onTrainCase = vi.fn();
    const render = () => renderRoot(() => StatisticsCaseTable({ family, rows, focus: rows.map(row => ({ reason: "total" as const, row })), skipCount: 0, model, onOpenSolve: vi.fn(), onTrainCase }));
    let tree = render();
    find(tree, (element) => element.type === "button" && element.props.children === "Train").props.onClick();
    expect(onTrainCase).toHaveBeenCalledWith(family, caseId);
    find(tree, (element) => element.type === "button" && element.props.children === "View").props.onClick();
    tree = render();
    expect(find(tree, (element) => element.props["aria-label"] === `${family.toUpperCase()} case solves`)).toBeDefined();
    // The detail opens inside the table, under its own row, rather than after the whole table.
    const table = find(tree, (element) => element.type === PerformanceTable);
    expect(table.props.expandedLabel).toBe(caseId);
    expect(find(table.props.expanded, (element) => element.props["aria-label"] === `${family.toUpperCase()} case solves`)).toBeDefined();
    table.props.onSelect(rows[0]);
    tree = render();
    expect(find(tree, (element) => element.type === PerformanceTable).props.expandedLabel).toBeUndefined();
  });

  it("reverses a CFOP ranking from its value header instead of a direction selector", () => {
    const render = () => renderRoot(() => StatisticsCfopRecords({ model, onOpenSolve: vi.fn() }));
    let tree = render();
    expect(elements(tree).filter((element) => element.type === "select")).toHaveLength(1);
    const table = () => find(tree, (element) => element.type === StatisticsRankingTable);
    expect(table().props.direction).toBe("asc");
    table().props.onToggleDirection();
    tree = render();
    expect(table().props.direction).toBe("desc");
    const ranked = StatisticsRankingTable({ ...(table().props as Parameters<typeof StatisticsRankingTable>[0]), rows: model.records.single });
    const header = find(ranked, (element) => element.type === "th" && element.props["aria-sort"] !== undefined);
    expect(header.props["aria-sort"]).toBe("descending");
  });
});

describe("slowest case diagrams", () => {
  it.each([["oll", "27"], ["pll", "T"]] as const)("renders the canonical %s preview", async (family, caseId) => {
    const render = () => renderRoot(() => StatisticsCaseDiagram({ family, caseId }));
    render();
    for (const effect of hooks.effects) effect();
    await get3x3x3();
    await Promise.resolve();
    const tree = render();
    const thumbnail = find(tree, element => element.type === LastLayerCaseThumbnail);
    const built = buildLastLayerCatalogueTarget(await get3x3x3(), family, caseId);
    expect(thumbnail.props.model).toEqual(getLastLayerThumbnailModel(family, built.pattern, built.info.trainingRotation, built.info.completionGoal));
    expect(renderToStaticMarkup(tree)).toContain('data-region="top"');
    expect(renderToStaticMarkup(tree)).toContain(`${family.toUpperCase()} ${caseId} case diagram`);
  });
});

it("groups independent OLL and PLL tables below full-width F2L", () => {
  const tree = StatisticsAnalysisTables({ model, onOpenSolve: vi.fn(), onTrainCase: vi.fn() });
  const group = find(tree, element => element.props.className === "statistics-case-layout");
  expect(elements(group).filter(element => element.type === StatisticsCaseTable).map(element => element.props.family)).toEqual(["oll", "pll"]);
  expect(elements(group).some(element => element.type === StatisticsF2lPerformance)).toBe(false);
});

describe("shared result history", () => {
  it.each(["exclude", "dnf"] as const)("feeds both references through Session/Event scope and %s filtering", async handling => {
    const puzzle = await get3x3x3();
    const moves = ["R", "U", "R'", "U", "R", "U2", "R'"].map((move, i) => ({ move, t: (i + 1) * 300 }));
    const analysis = analyseSolve(puzzle.defaultPattern().applyAlg("R U2 R' U' R U' R'"), moves, null, { observedStartBottomFace: "D" });
    if (!analysis) throw new Error("Expected CFOP fixture analysis");
    const prior = Array.from({ length: 5 }, (_, i) => ({ ...item(`prior${i}`, "A", 2100, i), moves, analysis }));
    const slow = { ...prior[0], id: "slow", createdAt: 6, rawMs: 20000, analysis: { ...analysis, steps: analysis.steps.map(step => ({ ...step, timeMs: step.timeMs * 10 })) } };
    const other = { ...prior[0], id: "other", sessionId: "B", createdAt: 7 };
    const current = { ...prior[0], id: "current", createdAt: 8 };
    const controller = new Controller();
    hooks.controller = controller;
    controller.sessions.update(state => ({ ...state, sessions: snapshot.sessions }));
    controller.settings.update(settings => ({ ...settings, slowSolveThreshold: 3, slowSolveHandling: handling }));
    const local = [...prior, slow, current];
    const read = () => { hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; return useResultHistory(current, local); };
    let history = read();
    expect(history.comparison?.sampleSize).toBe(5);
    expect(history.spread?.find(row => row.name === "OLL")?.samples).toHaveLength(5);
    controller.sessions.update(state => ({ ...state, sessions: state.sessions.map(session => ({ ...session, compareScope: "event" as const })) }));
    vi.spyOn(controller, "loadStatisticsSnapshot").mockResolvedValue({ sessions: snapshot.sessions, solves: [...prior, slow, other, current] });
    history = read();
    expect(history.loading).toBe(true);
    expect(history.spread).toBeNull();
    for (const effect of hooks.effects) effect();
    await Promise.resolve();
    history = read();
    expect(history.comparison?.sampleSize).toBe(6);
    expect(history.spread?.find(row => row.name === "OLL")?.samples).toHaveLength(6);
    expect(history.comparison?.steps.find(row => row.name === "OLL")?.baselineMs).toBe(history.spread?.find(row => row.name === "OLL")?.medianMs);
  });
});

describe("case presentation contracts", () => {
  it("renders both F2L datasets with independent sorting and expansion", () => {
    const both = StatisticsF2lPerformance({ model, onOpenSolve: vi.fn() });
    expect(elements(both).filter(element => element.type === StatisticsF2lPerformancePanel).map(element => element.props.mode)).toEqual(["slot", "order"]);
    const pairedModel = { ...model, analysisCount: 1 };
    const render = () => renderRoot(() => <>{StatisticsF2lPerformancePanel({ mode: "slot", model: pairedModel, onOpenSolve: vi.fn() })}{StatisticsF2lPerformancePanel({ mode: "order", model: pairedModel, onOpenSolve: vi.fn() })}</>);
    let tables = elements(render()).filter(element => element.type === PerformanceTable);
    expect(tables[0].props.rows).toBe(model.f2lSlots);
    expect(tables[1].props.rows).toBe(model.f2lPositions);
    tables[0].props.onSelect(model.f2lSlots[0]);
    tables[1].props.onSelect(model.f2lPositions[1]);
    tables[0].props.sort.onSort("median");
    tables = elements(render()).filter(element => element.type === PerformanceTable);
    expect(tables[0].props.expandedLabel).toBe("FR");
    expect(tables[1].props.expandedLabel).toBe("2nd pair");
    expect(tables[0].props.sort.column).toBe("median");
    expect(tables[1].props.sort.column).toBeNull();
    expect(tables[0].props.expanded.props["aria-label"]).toBe("F2L insertion position solves");
    expect(tables[1].props.expanded.props["aria-label"]).toBe("F2L solve order solves");
    tables[1].props.onSelect(model.f2lPositions[1]);
    expect(elements(render()).filter(element => element.type === PerformanceTable)[0].props.expandedLabel).toBe("FR");
  });
  it.each(["oll", "pll"] as const)("explains all three %s weaknesses, allowing repeated cases", family => {
    const caseId = family === "oll" ? "27" : "T";
    const row = { caseId, label: caseId, count: 5, skipCount: 0, solveIds: [], samples: [], medianMs: 3840, recognitionMs: 1210, executionMs: 2630 };
    const html = renderToStaticMarkup(StatisticsCaseTable({ family, rows: [row], focus: focusCases([row]), skipCount: 0, model, onOpenSolve: vi.fn(), onTrainCase: vi.fn() }));
    for (const label of ["Worst total", "Worst recognition", "Worst execution", "Total 3.84", "Recognition 1.21", "Execution 2.63"]) expect(html).toContain(label);
    expect(html.match(/class="focus-case"/g)).toHaveLength(3);
  });
  it.each(["invalid case", "loading rejection"])("omits a thumbnail safely after %s", async failure => {
    if (failure === "loading rejection") vi.spyOn(puzzleLoading, "get3x3x3").mockRejectedValue(new Error("Unavailable"));
    const render = () => renderRoot(() => StatisticsCaseDiagram({ family: "oll", caseId: "not-in-catalogue" }));
    render(); for (const effect of hooks.effects) effect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const tree = render();
    expect(elements(tree).some(element => element.type === LastLayerCaseThumbnail)).toBe(false);
    expect(tree.props["aria-label"]).toBe("OLL not-in-catalogue case diagram");
    const row = { caseId: "not-in-catalogue", label: "not-in-catalogue", count: 3, skipCount: 0, solveIds: [], samples: [], medianMs: 2000 };
    const table = renderRoot(() => StatisticsCaseTable({ family: "oll", rows: [row], focus: focusCases([row]), skipCount: 0, model, onOpenSolve: vi.fn(), onTrainCase: vi.fn() }));
    expect(find(table, element => element.type === PerformanceTable).props.rows).toEqual([row]);
    expect(elements(table).some(element => element.type === "button" && element.props.children === "View")).toBe(true);
  });
});

describe("visible exact average dialogs", () => {
  const history = {
    sessions: snapshot.sessions,
    solves: Array.from({ length: 100 }, (_, index) => [
      item(`a${index}`, "A", 20000 - index * 10, index * 2),
      item(`b${index}`, "B", 30000 - index * 10, index * 2 + 1),
    ]).flat(),
  };
  it.each([5, 12, 50, 100] as const)("opens Ao%i from the top page as a modal with every chronological Session-local member", size => {
    const local = deriveStatistics(history, { event: "333", sessionId: null }, "A");
    const onOpenSolve = vi.fn();
    const render = () => renderRoot(() => StatisticsRecords({ model: local, onOpenSolve }));
    let tree = render();
    const solves = find(tree, element => element.type === StatsSection && element.props.id === "solves");
    expect(elements(solves).filter(element => element.type === "tr" && element.props.tabIndex === 0)).toHaveLength(50);
    // The outer table is time-sorted; the newest A solve is at the top.
    find(solves, element => element.props["aria-label"] === `View Ao${size} window ending at a99`).props.onClick({ stopPropagation: vi.fn() });
    tree = render();
    const selected = find(tree, element => element.type === StatisticsAverageDetail);
    const expected = local.solveRows.find(row => row.solve.id === "a99")!.averages[`ao${size}`]!;
    expect(selected.props.window).toBe(expected);
    const detail = StatisticsAverageDetail(selected.props as Parameters<typeof StatisticsAverageDetail>[0]);
    expect(detail.props.className).toBe("backdrop");
    const dialog = find(detail, element => element.props.role === "dialog");
    expect(dialog.props["aria-modal"]).toBe("true");
    expect(dialog.props.className).toContain("statistics-average-detail");
    const rows = elements(dialog).filter(element => element.type === "tr" && element.props.tabIndex === 0);
    expect(rows).toHaveLength(size);
    expect(rows.map(row => row.key)).toEqual(expected.entries.map(entry => entry.solveId));
    expect(expected.entries.every(entry => entry.solveId.startsWith("a"))).toBe(true);
    const statuses = elements(dialog).filter(element => element.props.className?.includes("average-status-"));
    expect(statuses.map(status => status.props.children)).toEqual(expected.entries.map(entry => entry.trim === "kept" ? "Counted" : `Discarded ${entry.trim}`));
    find(rows[0], element => element.type === "button").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(local.scopeSolves.find(solve => solve.id === expected.entries[0].solveId));
    expect(elements(render()).some(element => element.type === StatisticsAverageDetail)).toBe(false);
  });
  it.each([5, 12, 50, 100] as const)("uses the same Ao%i dialog for PB cards and PB history", size => {
    const local = deriveStatistics(history, { event: "333", sessionId: null }, "A");
    const render = () => renderRoot(() => StatisticsRecords({ model: local, onOpenSolve: vi.fn() }));
    let tree = render();
    const summary = find(tree, element => typeof element.type === "function" && element.props.onOpenAverage);
    const cards = (summary.type as (props: any) => Element)(summary.props);
    find(cards, element => element.type === StatCard && element.props.label === `Best Ao${size}`).props.onOpen();
    const modal = () => {
      const selected = find(render(), element => element.type === StatisticsAverageDetail);
      const detail = StatisticsAverageDetail(selected.props as Parameters<typeof StatisticsAverageDetail>[0]);
      expect(find(detail, element => element.props.role === "dialog").props["aria-modal"]).toBe("true");
      return detail;
    };
    find(modal(), element => element.type === "button" && element.props.children === "Close average").props.onClick();
    tree = render();
    find(tree, element => element.type === "select").props.onChange({ target: { value: `ao${size}` } });
    const pb = find(render(), element => element.type === StatsSection && element.props.id === "pb-history");
    find(pb, element => element.type === "tr" && element.props.tabIndex === 0).props.onClick(clickEvent());
    modal();
  });
  it("explains missing averages without buttons and preserves the single Time action", () => {
    const local = deriveStatistics(snapshot, { event: "333", sessionId: null }, "A");
    const onOpenSolve = vi.fn();
    const tree = renderRoot(() => StatisticsRecords({ model: local, onOpenSolve }));
    const row = find(tree, element => element.type === "tr" && element.props.tabIndex === 0);
    const missing = find(row, element => element.type === "span" && element.props.title?.startsWith("No Ao50"));
    expect(missing.props.title).toContain("50 counted solves in the same Session");
    expect(elements(missing).some(element => element.type === "button")).toBe(false);
    find(row, element => element.type === "button").props.onClick();
    expect(onOpenSolve).toHaveBeenCalledWith(local.scopeSolves[5]);
    expect(elements(tree).some(element => element.type === StatisticsAverageDetail)).toBe(false);
  });
  it("replaces the average modal with the existing historical solve modal", async () => {
    const controller = new Controller(); hooks.controller = controller;
    vi.spyOn(controller, "loadStatisticsSnapshot").mockResolvedValue(history);
    const viewValues: unknown[] = [], recordValues: unknown[] = [];
    const viewDependencies: (readonly unknown[] | undefined)[] = [];
    const props = { currentEvent: "333" as const, activeSessionId: "A", view: "Solves" as const, onViewChange: vi.fn(), onReplay: vi.fn(), onSolveAgain: vi.fn(), onTrainCase: vi.fn(), onScopeChange: vi.fn() };
    const renderView = () => {
      hooks.values = viewValues; hooks.dependencies = viewDependencies;
      return renderRoot(() => StatisticsView(props));
    };
    renderView(); for (const effect of hooks.effects) effect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const renderRecords = () => {
      const records = find(renderView(), element => element.type === StatisticsRecords);
      hooks.values = recordValues; hooks.dependencies = [];
      return renderRoot(() => StatisticsRecords(records.props as Parameters<typeof StatisticsRecords>[0]));
    };
    find(renderRecords(), element => element.props["aria-label"] === "View Ao5 window ending at a99").props.onClick({ stopPropagation: vi.fn() });
    const selected = find(renderRecords(), element => element.type === StatisticsAverageDetail);
    const average = StatisticsAverageDetail(selected.props as Parameters<typeof StatisticsAverageDetail>[0]);
    find(average, element => element.type === "tr" && element.props.tabIndex === 0).props.onKeyDown(keyEvent("Enter"));
    expect(elements(renderRecords()).some(element => element.type === StatisticsAverageDetail)).toBe(false);
    const historical = find(renderView(), element => element.type === StatisticsSolveDetail);
    expect(historical.props.solve.id).toBe("a95");
    const detail = StatisticsSolveDetail(historical.props as Parameters<typeof StatisticsSolveDetail>[0]);
    expect(elements(detail).filter(element => element.props["aria-modal"] === "true")).toHaveLength(1);
  });
  it.each(["size", "length", "order"])("rejects a stale selected window when its %s changes", change => {
    let local = deriveStatistics(history, { event: "333", sessionId: "A" }, "A");
    const render = () => renderRoot(() => StatisticsRecords({ model: local, onOpenSolve: vi.fn() }));
    find(render(), element => element.props["aria-label"] === "View Ao5 window ending at a99").props.onClick({ stopPropagation: vi.fn() });
    expect(find(render(), element => element.type === StatisticsAverageDetail)).toBeDefined();
    local = { ...local, solveRows: local.solveRows.map(row => {
      if (row.solve.id !== "a99") return row;
      const window = row.averages.ao5!;
      return { ...row, averages: { ...row.averages, ao5: { ...window,
        size: change === "size" ? 12 : window.size,
        entries: change === "length" ? window.entries.slice(0, -1) : change === "order" ? [...window.entries].reverse() : window.entries,
      } } };
    }) };
    expect(elements(render()).some(element => element.type === StatisticsAverageDetail)).toBe(false);
  });
});

describe("Statistics shortcuts", () => {
  it.each(["counted", "Ao5", "Ao12", "Ao50", "Ao100"])("routes Timer %s to Solves, including projected long averages", async label => {
    const controller = new Controller(); hooks.controller = controller;
    controller.state.update(state => ({ ...state, ready: true }));
    const solves = Array.from({ length: 12 }, (_, i) => item(`p${i}`, "A", 10000, i));
    controller.sessions.update(state => ({ ...state, sessions: snapshot.sessions, sessionId: "A", solves }));
    const appValues: unknown[] = [], statisticsValues: unknown[] = [];
    const appDependencies: (readonly unknown[] | undefined)[] = [], statisticsDependencies: (readonly unknown[] | undefined)[] = [];
    const render = () => { hooks.values = appValues; hooks.dependencies = appDependencies; return renderRoot(() => App()); };
    vi.spyOn(controller, "loadStatisticsSnapshot").mockResolvedValue({ sessions: snapshot.sessions, solves });
    const renderStatistics = () => {
      const props = find(render(), element => element.type === StatisticsView).props;
      hooks.values = statisticsValues; hooks.dependencies = statisticsDependencies;
      const result = renderRoot(() => StatisticsView(props as Parameters<typeof StatisticsView>[0]));
      for (const effect of hooks.effects) effect();
      return result;
    };
    // Reproduce a synchronous external-store render during the area transition.
    const unsubscribe = controller.state.subscribe(() => {
      if (controller.state.get().area === "statistics") renderStatistics();
    });
    let tree = render();
    const panelProps = find(tree, element => element.type === StatsPanel).props;
    const panel = StatsPanel(panelProps as Parameters<typeof StatsPanel>[0]);
    if (label === "counted") find(panel, element => element.props["aria-label"] === "View counted solves").props.onClick();
    else {
      const shortcut = find(panel, element => element.type === Stat && element.props.label === label);
      if (label === "Ao50" || label === "Ao100") expect(shortcut.props.sub).toContain("Projected average");
      const button = Stat(shortcut.props as Parameters<typeof Stat>[0]);
      expect(button.type).toBe("button"); button.props.onClick();
    }
    tree = render();
    expect(controller.state.get().area).toBe("statistics");
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    let statistics = renderStatistics();
    const navigation = StatisticsNavigation(find(statistics, element => element.type === StatisticsNavigation).props as Parameters<typeof StatisticsNavigation>[0]);
    expect(find(navigation, element => element.props.children === "Solves").props["aria-pressed"]).toBe(true);
    expect(find(statistics, element => element.type === StatisticsRecords)).toBeDefined();
    find(tree, element => element.type === Header).props.onSelectArea("timer");
    tree = render(); find(tree, element => element.type === Header).props.onSelectArea("statistics");
    statistics = renderStatistics();
    expect(find(statistics, element => element.type === StatisticsNavigation).props.view).toBe("Overview");
    find(statistics, element => element.type === StatisticsOverview).props.onOpenSolves();
    expect(find(renderStatistics(), element => element.type === StatisticsNavigation).props.view).toBe("Solves");
    unsubscribe();
  });
  it("makes Counted and every Overview average a Solves shortcut", () => {
    const onOpenSolves = vi.fn();
    const local = deriveStatistics({ ...snapshot, solves: Array.from({ length: 12 }, (_, i) => item(`p${i}`, "A", 10000, i)) }, { event: "333", sessionId: "A" }, "A");
    const summary = StatisticsOverviewSummary({ model: local, onOpenSolves });
    const cards = elements(summary).filter(element => element.type === StatCard && element.props.onOpen);
    expect(cards.map(card => card.props.label)).toEqual(["Counted solves", "Ao5", "Ao12", "Projected Ao50", "Projected Ao100"]);
    for (const card of cards) card.props.onOpen();
    expect(onOpenSolves).toHaveBeenCalledTimes(5);
  });
});

describe("historical detail coherence", () => {
  it("updates the snapshot and open detail, then deletes without changing Timer scope", async () => {
    const controller = new Controller(); hooks.controller = controller;
    controller.sessions.update(state => ({ ...state, sessionId: "A", sessions: snapshot.sessions, solves: [snapshot.solves[1]] }));
    const puzzle = await get3x3x3();
    const moves = [{ move: "R", t: 1000 }];
    const analysis = analyseSolve(puzzle.defaultPattern().applyAlg("R'"), moves, null, { observedStartBottomFace: "D" });
    const historical = { ...snapshot.solves[0], moves, analysis };
    vi.spyOn(controller, "loadStatisticsSnapshot").mockResolvedValue({ ...snapshot, solves: [historical, ...snapshot.solves.slice(1)] });
    const update = vi.spyOn(controller, "updateHistoricalSolve").mockImplementation(async (solve, changes) => ({ ...solve, ...changes }));
    const remove = vi.spyOn(controller, "deleteSolve").mockResolvedValue();
    const again = vi.fn();
    const props = { currentEvent: "333" as const, activeSessionId: "A", view: "Solves" as StatisticsSubview, onViewChange: vi.fn(), onReplay: vi.fn(), onSolveAgain: again, onTrainCase: vi.fn(), onScopeChange: vi.fn() };
    const render = () => renderRoot(() => StatisticsView(props));
    render(); for (const effect of hooks.effects) effect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    let tree = render();
    find(tree, element => element.type === StatisticsRecords).props.onOpenSolve(historical);
    const detail = () => find(render(), element => element.type === StatisticsSolveDetail);
    const controls = () => {
      const current = detail();
      const body = StatisticsSolveDetail(current.props as Parameters<typeof StatisticsSolveDetail>[0]);
      return SolveActions(find(body, element => element.type === SolveActions).props as Parameters<typeof SolveActions>[0]);
    };
    for (const penalty of ["+2", "DNF", "OK"]) {
      find(controls(), element => element.type === "button" && element.props.children === penalty).props.onClick();
      await Promise.resolve(); await Promise.resolve();
      expect(detail().props.solve.penalty).toBe(penalty === "OK" ? "none" : penalty);
      expect(find(render(), element => element.type === StatisticsRecords).props.model.scopeSolves.find((solve: Solve) => solve.id === "s0").penalty).toBe(penalty === "OK" ? "none" : penalty);
    }
    find(controls(), element => element.type === "button" && element.props.children === "Mark CFOP wrong").props.onClick();
    await Promise.resolve(); await Promise.resolve();
    expect(detail().props.solve.cfopAnalysisExcluded).toBe(true);
    expect(find(controls(), element => element.props.children === "Review").props.disabled).toBe(false);
    expect(elements(StatisticsSolveDetail(detail().props as Parameters<typeof StatisticsSolveDetail>[0])).some(element => element.type === SolveAnalysisReview)).toBe(true);
    find(controls(), element => element.type === "button" && element.props.children === "Undo CFOP exclusion").props.onClick();
    await Promise.resolve(); await Promise.resolve();
    expect(detail().props.solve.cfopAnalysisExcluded).toBeUndefined();
    find(controls(), element => element.type === "input").props.onBlur({ target: { value: "Updated note" } });
    await Promise.resolve(); await Promise.resolve();
    expect(detail().props.solve.comment).toBe("Updated note");
    detail().props.onSolveAgain(); expect(again).toHaveBeenCalledWith(detail().props.solve);
    await detail().props.onDelete();
    tree = render();
    expect(elements(tree).some(element => element.type === StatisticsSolveDetail)).toBe(false);
    expect(find(tree, element => element.type === StatisticsRecords).props.model.scopeSolves.some((solve: Solve) => solve.id === "s0")).toBe(false);
    expect(remove).toHaveBeenCalledWith("s0");
    expect(update.mock.calls[0][0].sessionId).toBe("B");
    expect(controller.sessions.get().sessionId).toBe("A");
  });
  it("replays a historical scramble after a Training detour without physical-position adoption", async () => {
    const controller = new Controller(new CubeModel(await get3x3x3())); hooks.controller = controller;
    controller.state.update(state => ({ ...state, ready: true }));
    controller.setArea("training");
    await controller.setTrainingMode("virtual");
    await controller.selectF2lCase("F2L 1");
    expect(controller.training.state.get().target).not.toBeNull();
    controller.setArea("statistics");
    const returned = vi.spyOn(controller, "returnToTimerReview");
    const adoption = vi.spyOn(controller.timer, "useCubeStateAsScramble").mockResolvedValue("applied");
    const replay = vi.spyOn(controller, "replayScramble");
    const historical = { ...snapshot.solves[0], scrambleProvider: "333-random-state" };
    const tree = renderRoot(() => App());
    find(tree, element => element.type === StatisticsView).props.onSolveAgain(historical);
    expect(returned).toHaveReturnedWith(true);
    expect(adoption).not.toHaveBeenCalled();
    expect(controller.training.state.get()).toMatchObject({ phase: "selecting", target: null });
    expect(controller.state.get().area).toBe("timer");
    expect(controller.timer.state.get().scramble).toBe(historical.scramble);
    expect(replay).toHaveBeenCalledWith(historical.scramble, historical.scrambleProvider);
  });
  it("routes historical Solve again through App to Timer with the original provider", () => {
    const controller = new Controller(); hooks.controller = controller;
    controller.state.update(state => ({ ...state, ready: true, area: "statistics" }));
    const replay = vi.spyOn(controller, "replayScramble").mockImplementation(() => {});
    const historical = { ...snapshot.solves[0], scrambleProvider: "333-random-state" };
    const tree = renderRoot(() => App());
    find(tree, element => element.type === StatisticsView).props.onSolveAgain(historical);
    expect(controller.state.get().area).toBe("timer");
    expect(replay).toHaveBeenCalledWith(historical.scramble, historical.scrambleProvider);
  });
});
