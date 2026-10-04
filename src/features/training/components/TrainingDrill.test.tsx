import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../../app/Controller";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import * as db from "../../../infrastructure/persistence/db";
import type { TrainingDrillPreset } from "../../../app/types";
import type { MoveGuide } from "../../../cube/moveGuide";
import { Training } from "./Training";
import { TrainingDrillPanel, TrainingDrillControls, TrainingDrillSummary, SavedDrills } from "./TrainingDrill";
import { TrainingWorkspace, TrainingCubeStage, TrainingActions, TrainingReferences, TrainingAttemptResult } from "./TrainingWorkspace";
import { TrainingPersonalPerformance } from "./TrainingPerformance";
const hooks = vi.hoisted(() => ({ controller: null as Controller | null, inlineState: null as unknown[] | null, cursor: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useMemo: (make: () => unknown) => make(), useEffect: () => {},
  useState: (initial: unknown) => {
    if (!hooks.inlineState) return [initial, () => {}];
    const index = hooks.cursor++;
    if (!(index in hooks.inlineState)) hooks.inlineState[index] = initial;
    return [hooks.inlineState[index], (next: unknown) => { hooks.inlineState![index] = next; }];
  }, useRef: () => ({ current: null }),
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
afterEach(() => { hooks.inlineState = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
function button(label: string, element: ReactNode = <Training />): Button { return buttons(element).find(b => b["aria-label"] === label || text(b.children) === label)!; }
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
    expect(renderToStaticMarkup(<TrainingDrillPanel />)).toContain("Starting");
    expect(renderToStaticMarkup(<TrainingDrillPanel />)).not.toContain("Round 0");
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
    expect(html).toContain("Drill complete"); expect(html).toContain("1 round · 0 solved · 1 skipped");
    expect(html).toContain("Needs work"); expect(html).toContain("1 skip");
    expect(html).not.toContain("Avg case time"); expect(button("Drill weak cases").disabled).toBe(false);
    button("Drill weak cases").onClick();
    expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", running: false, strategy: "weighted", selectedCaseIds: ["F2L 4"], outcomes: [] });
    reveal(); controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    button("Repeat same set").onClick(); expect(controller.training.state.get().drill).toMatchObject({ status: "configuring", running: false, strategy: "weighted", outcomes: [] });
    reveal(); controller.skipTrainingDrillCase(); controller.stopTrainingDrill();
    expect(button("Done")).toBeUndefined();
    expect(controller.training.state.get().activity).toBe("drill");
  });
  it("shows valid solved summary metrics and disables weak-case action for a clean run", () => {
    const { controller, reveal } = fixture(); reveal(); controller.stopTrainingDrill();
    controller.training.state.update(s => ({ ...s, drill: { ...s.drill, status: "summary", context: { family: "f2l", library: "basic", position: "FR" },
      outcomes: [{ caseId: "F2L 4", outcome: "solved", caseTimeMs: 2300, moveSpanMs: 1000, stm: 8, delta: 0, completedAt: 1 }] } }));
    const html = renderToStaticMarkup(<TrainingDrillSummary />);
    expect(html).toContain("1 round · 1 solved · 0 skipped"); expect(html).toContain("Avg case time"); expect(html).toContain("Best case time");
    expect(html).toContain("2.30"); expect(html).toContain("Avg STM"); expect(html).toContain("8.0");
    expect(button("Drill weak cases", <TrainingDrillSummary />).disabled).toBe(true);
  });
  it("shows complete Drill case time more prominently than registered move span, including zero spans", () => {
    const result = { moves: ["R"], stm: 1, elapsedMs: 0, caseTimeMs: 2300, recommendedStm: 1, preferredAlg: null, recommendedAlg: "R", matchedReferenceRank: 1, preferredStm: null, matchedPreferred: null, preferredDelta: null, delta: 0 };
    const html = renderToStaticMarkup(<TrainingAttemptResult result={result} phase="result" liveMoveCount={0} elapsed={500} activity="drill" />);
    expect(html).toContain("2.30"); expect(html).toContain("case time"); expect(html).toContain("Move span 0.00");
    expect(html).toContain("1 STM"); expect(html).toContain("Recommended solution");
    expect(html.indexOf("case time")).toBeLessThan(html.indexOf("Move span"));
  });
});

type UiProps = { children?: ReactNode; disabled?: boolean; value?: string; onClick?: () => unknown;
  onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault(): void }) => void;
  onKeyDown?: (event: { key: string; preventDefault(): void }) => void };
function nativeNodes(node: ReactNode, kind: string): UiProps[] {
  if (Array.isArray(node)) return node.flatMap(child => nativeNodes(child, kind));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<UiProps>;
  return [...(element.type === kind ? [element.props] : []), ...nativeNodes(element.props.children, kind)];
}
function savedUi() { hooks.cursor = 0; return SavedDrills(); }
const savedPreset = (values: Partial<TrainingDrillPreset> = {}): TrainingDrillPreset => ({
  id: "preset", name: "Same name", createdAt: 10, updatedAt: 20, context: { family: "pll", trainingSet: "2look" },
  caseIds: ["Headlights"], strategy: "weighted", ...values,
});
async function settleUi() { await new Promise<void>(resolve => setTimeout(resolve, 0)); }

describe("Saved drills configuration presentation", () => {
  it("shows an empty state and keeps normal manual configuration available", () => {
    fixture();
    expect(renderToStaticMarkup(<Training />)).toContain("No saved drills yet.");
    expect(button("Save current as…", <TrainingDrillPanel />).disabled).toBe(true);
    expect(button("Start drill").disabled).toBe(true);
    button("Select all").onClick();
    expect(button("Save current as…", <TrainingDrillPanel />).disabled).toBe(false);
  });
  it("saves with an inline form, rejects blank names, closes after success and preserves configuration", async () => {
    const { controller } = fixture(); controller.setDrillCases(["F2L 4"]); hooks.inlineState = [];
    vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue();
    const create = vi.spyOn(controller, "createTrainingDrillPreset");
    const before = controller.training.state.get();
    button("Save current as…", savedUi()).onClick();
    expect(nativeNodes(savedUi(), "input")).toHaveLength(1);
    expect(button("Save", savedUi()).disabled).toBe(true);
    nativeNodes(savedUi(), "form")[0].onSubmit!({ preventDefault() {} }); expect(create).not.toHaveBeenCalled();
    nativeNodes(savedUi(), "input")[0].onChange!({ target: { value: "  New drill  " } });
    expect(button("Save", savedUi()).disabled).toBe(false);
    nativeNodes(savedUi(), "form")[0].onSubmit!({ preventDefault() {} }); await settleUi();
    expect(create).toHaveBeenCalledWith("  New drill  "); expect(controller.trainingDrillPresets.get()[0].name).toBe("New drill");
    expect(nativeNodes(savedUi(), "input")).toHaveLength(0); expect(controller.training.state.get()).toBe(before);
  });
  it("keeps the editor open and existing list intact when saving fails", async () => {
    const { controller } = fixture(); controller.setDrillCases(["F2L 4"]); hooks.inlineState = [];
    vi.spyOn(db, "saveTrainingDrillPreset").mockRejectedValue(new Error("quota"));
    button("Save current as…", savedUi()).onClick();
    nativeNodes(savedUi(), "input")[0].onChange!({ target: { value: "New" } });
    nativeNodes(savedUi(), "form")[0].onSubmit!({ preventDefault() {} }); await settleUi();
    expect(nativeNodes(savedUi(), "input")[0].value).toBe("New");
    expect(controller.trainingDrillPresets.get()).toEqual([]); expect(controller.state.get().error).toContain("quota");
  });
  it("renders all families and distinguishes duplicate names using context", () => {
    const { controller } = fixture();
    controller.trainingDrillPresets.set([savedPreset(), savedPreset({ id: "other", context: { family: "f2l", library: "advanced", position: "BL" }, caseIds: ["AF2L 1", "AF2L 2"], strategy: "sequence" })]);
    const html = renderToStaticMarkup(<TrainingDrillPanel />);
    expect(html.match(/Same name/g)).toHaveLength(2);
    expect(html).toContain("2-Look PLL · 1 case · Weighted worst");
    expect(html).toContain("Advanced F2L · Back Left · 2 cases · Sequence");
  });
  it("Load switches family, Settings and case-card selection while leaving Start explicit", async () => {
    const { controller } = fixture(); const preset = savedPreset(); controller.trainingDrillPresets.set([preset]); hooks.inlineState = [];
    vi.spyOn(db, "saveSettings").mockResolvedValue(); const apply = vi.spyOn(controller, "applyTrainingDrillPreset");
    button("Load", savedUi()).onClick(); await settleUi();
    expect(apply).toHaveBeenCalledWith(preset.id);
    expect(controller.training.state.get()).toMatchObject({ family: "pll", drill: { strategy: "weighted", selectedCaseIds: ["Headlights"], running: false, status: "configuring" } });
    const html = renderToStaticMarkup(<Training />);
    expect(html).toContain("2-Look PLL cases"); expect(html).toContain("✓ Selected");
    expect(controller.training.drillCountdown.get()).toBeNull(); expect(button("Start drill").disabled).toBe(false);
  });
  it("Update stays disabled for an empty pool and persists only after explicit action", async () => {
    const { controller } = fixture(); const preset = savedPreset(); controller.trainingDrillPresets.set([preset]); hooks.inlineState = [];
    vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue();
    expect(button("Update", savedUi()).disabled).toBe(true);
    controller.setDrillCases(["F2L 4"]); controller.setDrillStrategy("random");
    expect(controller.trainingDrillPresets.get()[0]).toBe(preset);
    button("Update", savedUi()).onClick(); await settleUi();
    expect(controller.trainingDrillPresets.get()[0]).toMatchObject({ id: preset.id, name: preset.name, context: { family: "f2l", library: "basic", position: "FR" }, caseIds: ["F2L 4"], strategy: "random" });
  });
  it("renames inline, Cancel/Escape leave records unchanged", async () => {
    const { controller } = fixture(); const preset = savedPreset(); controller.trainingDrillPresets.set([preset]); hooks.inlineState = [];
    vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue();
    button("Rename", savedUi()).onClick(); expect(nativeNodes(savedUi(), "input")[0].value).toBe(preset.name);
    nativeNodes(savedUi(), "input")[0].onChange!({ target: { value: "Cancel me" } });
    button("Cancel", savedUi()).onClick(); expect(controller.trainingDrillPresets.get()[0]).toBe(preset);
    button("Rename", savedUi()).onClick();
    nativeNodes(savedUi(), "form")[0].onKeyDown!({ key: "Escape", preventDefault() {} });
    expect(nativeNodes(savedUi(), "form")).toHaveLength(0);
    button("Rename", savedUi()).onClick();
    nativeNodes(savedUi(), "input")[0].onChange!({ target: { value: " Renamed " } });
    nativeNodes(savedUi(), "form")[0].onSubmit!({ preventDefault() {} }); await settleUi();
    expect(controller.trainingDrillPresets.get()[0]).toEqual({ ...preset, name: "Renamed", updatedAt: expect.any(Number) });
    expect(nativeNodes(savedUi(), "form")).toHaveLength(0);
  });
  it("delete confirms, selects the remaining record and leaves the selected case pool unchanged", async () => {
    const { controller } = fixture(); controller.setDrillCases(["F2L 4"]);
    controller.trainingDrillPresets.set([savedPreset(), savedPreset({ id: "other", name: "Other" })]); hooks.inlineState = [];
    vi.spyOn(db, "deleteTrainingDrillPreset").mockResolvedValue(); vi.stubGlobal("confirm", vi.fn(() => false));
    button("Delete", savedUi()).onClick(); expect(db.deleteTrainingDrillPreset).not.toHaveBeenCalled();
    vi.stubGlobal("confirm", vi.fn(() => true)); const before = controller.training.state.get();
    button("Delete", savedUi()).onClick(); await settleUi();
    expect(nativeNodes(savedUi(), "select")[0].value).toBe("other"); expect(controller.training.state.get()).toBe(before);
  });
  it.each(["running", "summary"] as const)("hides all preset controls in %s, even if the configuration panel is mounted", status => {
    const { controller } = fixture(); controller.trainingDrillPresets.set([savedPreset()]);
    controller.training.state.update(s => ({ ...s, drill: { ...s.drill, status, running: status === "running" } }));
    expect(SavedDrills()).toBeNull(); expect(renderToStaticMarkup(<TrainingDrillPanel />)).not.toContain("Saved drills");
    expect(renderToStaticMarkup(<Training />)).not.toContain("Save current as");
  });
  it("renders multiple completed outcomes as rounds", () => {
    const { controller } = fixture();
    controller.training.state.update(s => ({ ...s, drill: { ...s.drill, status: "summary", outcomes: [
      { caseId: "F2L 4", outcome: "skipped", completedAt: 1 }, { caseId: "F2L 5", outcome: "skipped", completedAt: 2 },
    ] } }));
    expect(renderToStaticMarkup(<TrainingDrillSummary />)).toContain("2 rounds");
    expect(button("Done", <TrainingDrillSummary />)).toBeUndefined();
  });
});


it("visibly disables Start while a saved Drill load is applying", () => {
  const { controller } = fixture(); controller.setDrillCases(["F2L 4"]);
  expect(button("Start drill").disabled).toBe(false);
  controller.trainingDrillPresetApplying.set(true);
  expect(button("Start drill").disabled).toBe(true);
});
