import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../../app/Controller";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import type { MoveGuide } from "../../../cube/moveGuide";
import { Training } from "./Training";
import { TrainingDrillPanel, TrainingDrillControls, TrainingDrillSummary } from "./TrainingDrill";
import { TrainingWorkspace, TrainingCubeStage, TrainingActions, TrainingReferences, TrainingAttemptResult } from "./TrainingWorkspace";
import { TrainingPersonalPerformance } from "./TrainingPerformance";
const hooks = vi.hoisted(() => ({ controller: null as Controller | null }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (make: () => unknown) => make(), useEffect: () => {},
  useState: (initial: unknown) => [initial, () => {}], useRef: () => ({ current: null }),
  memo: (component: unknown) => component,
}));
vi.mock("../../../app/useController", () => ({
  useController: () => hooks.controller,
  useTrainingState: () => hooks.controller!.training.state.get(),
  useSettings: () => hooks.controller!.settings.get(),
  useStore: (store: { get(): unknown }) => store.get(),
  useStoreValue: (store: { get(): unknown }, select: (value: unknown) => unknown) => select(store.get()),
}));
vi.mock("../../../shared/ui/ConnectionPanel", () => ({ ConnectionPanel: () => null }));
vi.mock("../../../shared/ui/CubeView", () => ({ CubeView: (props: { guideMove?: MoveGuide | null }) => <div data-cube="visible" data-guide={props.guideMove?.token} /> }));
const kpuzzle = await get3x3x3();
beforeEach(() => { vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type Button = { children?: ReactNode; onClick(): unknown; disabled?: boolean; "aria-label"?: string; "aria-pressed"?: boolean; className?: string };
function buttons(node: ReactNode): Button[] {
  const found: Button[] = [];
  function visit(value: ReactNode): void {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const element = value as ReactElement<{ children?: ReactNode }>;
    if (typeof element.type === "function") visit((element.type as (props: unknown) => ReactNode)(element.props));
    else { if (element.type === "button") found.push(element.props as Button); visit(element.props.children); }
  }
  visit(node); return found;
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("") :
  typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as ReactElement<{ children?: ReactNode }>).props.children) : "";
function button(label: string, element = <Training />): Button { return buttons(element).find(b => b["aria-label"] === label || text(b.children) === label)!; }
function fixture(family: "f2l" | "oll" | "pll" = "f2l") {
  let now = 100; vi.spyOn(performance, "now").mockImplementation(() => now); vi.spyOn(Math, "random").mockReturnValue(0);
  const controller = new Controller(new CubeModel(kpuzzle)); hooks.controller = controller;
  controller.setArea("training"); controller.setTrainingFamily(family); controller.setTrainingActivity("drill");
  const caseId = family === "f2l" ? "F2L 4" : family === "oll" ? "27" : "T";
  const reveal = () => { controller.setDrillCases([caseId]); controller.startTrainingDrill(); now += 2000; controller.training.tick(now); };
  return { controller, caseId, reveal };
}
const workspace = <TrainingWorkspace library={null} details={<div>ANSWER ID AND GROUP</div>} emptyMessage="Choose case" />;
describe("Single and Drill presentation", () => {
  it.each(["f2l", "oll", "pll"] as const)("makes %s activity and selection controls explicit and routes card toggles without loading", family => {
    const { controller, caseId } = fixture(family);
    const html = renderToStaticMarkup(<Training />);
    expect(html).toContain('aria-label="Training activity"'); expect(html).toContain(">Single</button>"); expect(html).toContain(">Drill</button>");
    expect(html).toContain("Select all"); expect(html).toContain("0 selected"); expect(html).toContain("Weighted worst");
    expect(html).toContain("Drills use Virtual case mode"); expect(button("Start drill").disabled).toBe(true);
    expect(html).not.toContain("Random case"); expect(html).not.toContain("Review next");
    const card = buttons(<Training />).find(b => b["aria-label"]?.startsWith(family === "f2l" ? `${caseId},` : `${family.toUpperCase()} ${caseId}`)) ??
      buttons(<Training />).find(b => b["aria-label"]?.endsWith(caseId));
    expect(card).toBeDefined(); card!.onClick();
    expect(controller.training.state.get().target).toBeNull(); expect(controller.training.state.get().drill.selectedCaseIds).toEqual([caseId]);
    expect(renderToStaticMarkup(<Training />)).toContain("✓ Selected"); expect(button("Start drill").disabled).toBe(false);
    button("Select all").onClick(); expect(controller.training.state.get().drill.selectedCaseIds.length).toBeGreaterThan(1);
    const cardOrder = buttons(<Training />).filter(b => b.className?.includes("case-button"))
      .map(b => family === "f2l" ? b["aria-label"]!.split(",")[0] : b["aria-label"]!.replace(new RegExp(`^${family.toUpperCase()} `), ""));
    expect(controller.training.state.get().drill.selectedCaseIds).toEqual(cardOrder);
    button("Clear").onClick(); expect(controller.training.state.get().drill.selectedCaseIds).toEqual([]);
    button("Single").onClick(); expect(renderToStaticMarkup(<Training />)).toContain("Random case");
  });
  it("shows a concealed initial countdown then hides answer, metrics, reference and arrow while ready/solving", () => {
    const { controller } = fixture(); controller.setDrillCases(["F2L 4", "F2L 5"]); controller.startTrainingDrill();
    const initial = renderToStaticMarkup(<TrainingCubeStage />);
    expect(initial).toContain("Case starting"); expect(initial).toContain(">2</strong>"); expect(initial).not.toContain("data-cube");
    controller.training.tick(2100);
    const active = renderToStaticMarkup(workspace);
    expect(active).toContain("Skip case"); expect(active).toContain("Stop drill"); expect(active).not.toContain("ANSWER ID AND GROUP");
    expect(active).not.toContain("RECOMMENDED"); expect(active).not.toContain("Personal performance"); expect(active).not.toContain("data-guide=");
    expect(renderToStaticMarkup(<TrainingReferences />)).toBe(""); expect(renderToStaticMarkup(<TrainingPersonalPerformance />)).toBe("");
    const cards = buttons(<Training />).filter(b => b["aria-label"]?.startsWith("F2L "));
    expect(cards).toHaveLength(0); // Active run suppresses the full catalogue.
    const run = renderToStaticMarkup(<Training />);
    expect(run).toContain("Round 1"); expect(run).toContain("Solved"); expect(run).toContain("Skipped"); expect(run).toContain("2 selected");
    controller.injectMove("B"); expect(controller.training.state.get().phase).toBe("solving");
    expect(renderToStaticMarkup(workspace)).not.toContain("Skip case"); expect(renderToStaticMarkup(<TrainingActions />)).toBe("");
  });
  it("reveals skipped-case identity/reference during countdown with Stop and no Single actions", () => {
    const { controller, reveal } = fixture(); reveal(); button("Skip case", <TrainingDrillControls />).onClick();
    const html = renderToStaticMarkup(workspace);
    expect(html).toContain("Skipped"); expect(html).toContain("ANSWER ID AND GROUP"); expect(html).toContain("RECOMMENDED");
    expect(html).toContain("Personal performance"); expect(html).toContain("Next case in 2"); expect(html).toContain("Stop drill");
    for (const label of ["Again", "Next review", "Clear case", "Skip case"]) expect(html).not.toContain(label);
    button("Stop drill", <TrainingDrillPanel />).onClick(); expect(controller.training.state.get().target).toBeNull();
  });
  it("shows run summary and weak-case/repeat actions without automatically starting", () => {
    const { controller, reveal } = fixture(); controller.setDrillStrategy("random"); reveal();
    controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    let html = renderToStaticMarkup(<Training />);
    expect(html).toContain("Drill complete"); expect(html).toContain("1 rounds · 0 solved · 1 skipped");
    expect(html).toContain("Needs work"); expect(html).toContain("1 skip");
    expect(html).not.toContain("Avg case time"); expect(button("Drill weak cases").disabled).toBe(false);
    button("Drill weak cases").onClick();
    expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", running: false, strategy: "weighted", selectedCaseIds: ["F2L 4"], outcomes: [] });
    reveal(); controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    button("Repeat same set").onClick(); expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", running: false, strategy: "weighted", outcomes: [] });
    reveal(); controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    button("Done").onClick(); expect(controller.training.state.get().activity).toBe("drill");
  });
  it("shows valid solved summary metrics and disables weak-case action for a clean run", () => {
    const { controller, reveal } = fixture(); reveal(); controller.stopTrainingDrill();
    controller.training.state.update(s => ({ ...s, drill: { ...s.drill, status: "summary", context: { family: "f2l", library: "basic", position: "FR" },
      outcomes: [{ caseId: "F2L 4", outcome: "solved", caseTimeMs: 2300, moveSpanMs: 1000, stm: 8, delta: 0, completedAt: 1 }] } }));
    const html = renderToStaticMarkup(<TrainingDrillSummary />);
    expect(html).toContain("1 rounds · 1 solved · 0 skipped"); expect(html).toContain("Avg case time"); expect(html).toContain("Best case time");
    expect(html).toContain("2.30"); expect(html).toContain("Avg STM"); expect(html).toContain("8.0");
    expect(button("Drill weak cases", <TrainingDrillSummary />).disabled).toBe(true);
  });
  it("shows complete Drill case time more prominently than registered move span, including zero spans", () => {
    const result = { moves: ["R"], stm: 1, elapsedMs: 0, caseTimeMs: 2300, recommendedStm: 1, recommendedAlg: "R", matchedReferenceRank: 1, delta: 0 };
    const html = renderToStaticMarkup(<TrainingAttemptResult result={result} phase="result" liveMoveCount={0} elapsed={500} activity="drill" />);
    expect(html).toContain("2.30"); expect(html).toContain("case time"); expect(html).toContain("Move span 0.00");
    expect(html).toContain("1 STM"); expect(html).toContain("Recommended solution");
    expect(html.indexOf("case time")).toBeLessThan(html.indexOf("Move span"));
  });
});
