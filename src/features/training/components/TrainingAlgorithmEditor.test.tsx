import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../../app/Controller";
import { CubeModel } from "../../../cube/model";
import { get3x3x3 } from "../../../cube/puzzle";
import * as db from "../../../infrastructure/persistence/db";
import { catalogueIdentityForTarget } from "../../../app/trainingCatalogue";
import { TrainingAlgorithmEditor } from "./TrainingAlgorithmEditor";

const hooks = vi.hoisted(() => ({ controller: null as Controller | null, state: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
}));
vi.mock("../../../app/useController", () => ({ useController: () => hooks.controller }));
const kpuzzle = await get3x3x3();
type Props = { children?: ReactNode; disabled?: boolean; value?: string; onClick?: () => unknown;
  onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault(): void }) => void;
  onKeyDown?: (event: { key: string; preventDefault(): void }) => void };
function nodes(node: ReactNode, tag: string): Props[] {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, tag));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [...(element.type === tag ? [element.props] : []), ...nodes(element.props.children, tag)];
}
async function fixture() {
  const controller = new Controller(new CubeModel(kpuzzle)); hooks.controller = controller;
  controller.setArea("training"); await controller.setTrainingMode("virtual"); await controller.selectF2lCase("F2L 1");
  const identity = catalogueIdentityForTarget(controller.training.state.get().target)!;
  const draw = (canEdit = true) => { hooks.cursor = 0; return TrainingAlgorithmEditor({ identity, preference: controller.trainingAlgorithmPreferences.get()[0] ?? null, canEdit }); };
  const button = (label: string, canEdit = true) => nodes(draw(canEdit), "button").find(p => p.children === label)!;
  return { controller, draw, button };
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
afterEach(() => { hooks.state = []; hooks.cursor = 0; vi.restoreAllMocks(); });
describe("inline personal algorithm editor", () => {
  it("opens custom fields, disallows blank, shows validation feedback and closes after a valid save", async () => {
    const { controller, draw, button } = await fixture();
    vi.spyOn(db, "saveTrainingAlgorithmPreference").mockResolvedValue();
    const before = controller.training.state.get();
    button("Set custom algorithm").onClick!();
    expect(button("Save algorithm").disabled).toBe(true);
    nodes(draw(), "textarea")[0].onChange!({ target: { value: "R" } });
    nodes(draw(), "form")[0].onSubmit!({ preventDefault() {} }); await settle();
    expect(nodes(draw(), "textarea")).toHaveLength(2);
    expect(nodes(draw(), "p").some(p => String(p.children).includes("does not complete"))).toBe(true);
    const algorithm = before.target!.references[1].sourceAlg;
    nodes(draw(), "textarea")[0].onChange!({ target: { value: algorithm } });
    nodes(draw(), "textarea")[1].onChange!({ target: { value: "  My grip  " } });
    nodes(draw(), "form")[0].onSubmit!({ preventDefault() {} }); await settle();
    expect(controller.trainingAlgorithmPreferences.get()[0]).toMatchObject({ algorithm, note: "My grip", source: "custom" });
    expect(nodes(draw(), "form")).toHaveLength(0); expect(controller.training.state.get().target).toBe(before.target);
    expect(button("Edit")).toBeDefined();
  });
  it("Edit preloads source and note, Cancel/Escape leave the record alone, Remove delegates", async () => {
    const { controller, draw, button } = await fixture();
    vi.spyOn(db, "saveTrainingAlgorithmPreference").mockResolvedValue();
    vi.spyOn(db, "deleteTrainingAlgorithmPreference").mockResolvedValue();
    await controller.useCanonicalTrainingAlgorithm(controller.training.state.get().target!.references[0].sourceAlg);
    await controller.setTrainingAlgorithmPreference(controller.training.state.get().target!.references[0].sourceAlg, "grip");
    const record = controller.trainingAlgorithmPreferences.get()[0];
    button("Edit").onClick!();
    expect(nodes(draw(), "textarea")[0].value).toBe(record.algorithm);
    expect(nodes(draw(), "textarea")[1].value).toBe("grip");
    nodes(draw(), "textarea")[1].onChange!({ target: { value: "updated note" } });
    nodes(draw(), "form")[0].onSubmit!({ preventDefault() {} }); await settle();
    expect(controller.trainingAlgorithmPreferences.get()[0].source).toBe("catalog");
    button("Edit").onClick!();
    button("Cancel").onClick!(); expect(controller.trainingAlgorithmPreferences.get()[0]).toMatchObject({ algorithm: record.algorithm, source: "catalog", note: "updated note" });
    button("Edit").onClick!(); nodes(draw(), "form")[0].onKeyDown!({ key: "Escape", preventDefault() {} });
    expect(nodes(draw(), "form")).toHaveLength(0);
    button("Remove").onClick!(); await settle(); expect(controller.trainingAlgorithmPreferences.get()).toEqual([]);
    expect(db.deleteTrainingAlgorithmPreference).toHaveBeenCalledWith(record.key);
  });
  it("disables management at the active attempt boundary", async () => {
    const { button } = await fixture();
    expect(button("Set custom algorithm", false).disabled).toBe(true);
  });
});
