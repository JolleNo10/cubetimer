import { CfopAnalysisBadge } from "./CfopAnalysisQuality";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Solve } from "../../../app/types";
import { SolveList } from "./SolveList";

const hooks = vi.hoisted(() => ({ filter: "all", deleteSolve: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (make: () => unknown) => make(),
  useState: () => [hooks.filter, (value: string) => { hooks.filter = value; }],
}));
vi.mock("../../../app/useController", () => ({ useController: () => ({ deleteSolve: hooks.deleteSolve }) }));

type Element = ReactElement<Record<string, any>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
const solve = (id: string, changes: Partial<Solve> = {}): Solve => ({ id, sessionId: "A", createdAt: 1,
  rawMs: 10000, penalty: "none", source: "keyboard", scramble: "R U", moves: [], ...changes });
const solves = [solve("normal"), solve("slow", { slowSolve: true }), solve("replay", { replay: true }),
  solve("excluded", { statisticsOutlier: { action: "exclude", baselineMs: 10000, multiplier: 3 } }),
  solve("dnf", { penalty: "DNF" }), solve("autoDnf", { statisticsOutlier: { action: "dnf", baselineMs: 10000, multiplier: 3 } })];
const rows = (tree: unknown) => elements(tree).filter(element => element.props.className?.startsWith("solve-row"));
const chooser = (tree: unknown) => elements(tree).find(element => element.props["aria-label"] === "History solves")!;
beforeEach(() => { hooks.filter = "all"; hooks.deleteSolve.mockClear(); });

describe("History solve chooser", () => {
  it("switches between full history and counted solves, keeping both DNF kinds", () => {
    const props = { solves, selectedId: null, onSelect: vi.fn() };
    expect(rows(SolveList(props))).toHaveLength(6);
    chooser(SolveList(props)).props.onChange({ target: { value: "counted" } });
    const counted = SolveList(props);
    expect(rows(counted).map(row => row.key)).toEqual(["autoDnf", "dnf", "normal"]);
    expect(elements(counted).some(element => element.props.children === "3 / 6")).toBe(true);
    chooser(counted).props.onChange({ target: { value: "all" } });
    expect(rows(SolveList(props))).toHaveLength(6);
  });
  it("preserves original numbering and solve actions in the filtered list", () => {
    hooks.filter = "counted";
    const onSelect = vi.fn(), tree = SolveList({ solves, selectedId: "dnf", onSelect });
    const row = rows(tree).find(row => row.key === "dnf")!;
    expect(elements(row).find(element => element.props.className === "index")?.props.children).toBe(5);
    expect(row.props.className).toContain("selected"); row.props.onClick();
    expect(onSelect).toHaveBeenCalledWith(solves[4]);
    const deletion = elements(row).find(element => element.props["aria-label"] === "Delete solve 5")!;
    const stopPropagation = vi.fn(); deletion.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce(); expect(hooks.deleteSolve).toHaveBeenCalledWith("dnf");
  });
  it("distinguishes no recorded solves from no counted solves", () => {
    hooks.filter = "counted";
    const render = (solves: Solve[]) => SolveList({ solves, selectedId: null, onSelect: vi.fn() });
    expect(elements(render([solves[1]])).some(element => element.props.children === "No counted solves. Choose All solves to view the full history.")).toBe(true);
    expect(elements(render([])).some(element => element.props.children === "No solves yet. Scramble and go.")).toBe(true);
  });
});


it("includes independent CFOP badges without changing counted rows or PB eligibility", () => {
  hooks.filter = "counted";
  const uncertain = solve("uncertain", { source: "smartcube", analysis: { method: "CFOP", analysisVersion: 3, quality: { status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["D", "L"] }] } } as unknown as Solve["analysis"] });
  const missing = solve("missing", { source: "smartcube", rawMs: 9000, moves: [{ move: "R", t: 0 }] });
  const tree = SolveList({ solves: [uncertain, missing], selectedId: null, onSelect: vi.fn() });
  expect(rows(tree)).toHaveLength(2);
  const badges = elements(tree).filter(node => node.type === CfopAnalysisBadge);
  expect(badges.map(node => CfopAnalysisBadge(node.props as { solve: Solve })?.props.children)).toEqual(["no CFOP", "CFOP uncertain"]);
  expect(elements(rows(tree)[0]).some(node => node.props.children === "PB")).toBe(true);
});


it.each([{ slowSolve: true }, { replay: true }, { practice: true }])("keeps existing practice badges without compact CFOP warnings %j", flags => {
  for (const analysis of [null, { method: "CFOP", quality: { status: "suspect", issues: [] } } as unknown as Solve["analysis"]]) {
    const recorded = solve("practice", { source: "smartcube", moves: [{ move: "R", t: 0 }], analysis, cfopAnalysisExcluded: true, ...flags });
    const tree = SolveList({ solves: [recorded], selectedId: null, onSelect: vi.fn() });
    const badge = elements(tree).find(node => node.type === CfopAnalysisBadge)!;
    expect(CfopAnalysisBadge(badge.props as { solve: Solve })).toBeNull();
    if ("slowSolve" in flags || "replay" in flags) expect(elements(tree).some(node => node.props.children === ("slowSolve" in flags ? "slow" : "replay"))).toBe(true);
  }
});


it("shows manual exclusion ahead of automatic status while retaining PB eligibility", () => {
  const excluded = solve("manual", { source: "smartcube", rawMs: 8000, cfopAnalysisExcluded: true,
    analysis: { method: "CFOP", quality: { status: "suspect", issues: [] } } as unknown as Solve["analysis"] });
  const tree = SolveList({ solves: [excluded], selectedId: null, onSelect: vi.fn() });
  const badge = elements(tree).find(node => node.type === CfopAnalysisBadge)!;
  expect(CfopAnalysisBadge(badge.props as { solve: Solve })?.props.children).toBe("CFOP excluded");
  expect(elements(tree).some(node => node.props.children === "PB")).toBe(true);
});
