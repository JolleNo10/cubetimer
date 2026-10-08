import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { analyseSolve } from "../../../cube/analysis";
import { get3x3x3 } from "../../../cube/puzzle";
import type { Solve } from "../../../app/types";
import { SolveActions } from "./SolveActions";
import { SolveResult } from "./SolveResult";
import { SolveAnalysisReview } from "./SolveAnalysisReview";

const controller = vi.hoisted(() => ({ updateSolve: vi.fn().mockResolvedValue(undefined), clearCfopCorrection: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../app/useController", () => ({ useController: () => controller }));
type Element = ReactElement<Record<string, any>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  if (node.type === SolveActions) return elements(SolveActions(node.props as Parameters<typeof SolveActions>[0]));
  return [node, ...elements(node.props.children)];
}
const puzzle = await get3x3x3();
const solve: Solve = { id: "recorded", sessionId: "A", createdAt: 0, rawMs: 15000,
  penalty: "none", source: "smartcube", scramble: "R'", moves: [{ move: "R", t: 15000 }],
  analysis: analyseSolve(puzzle.defaultPattern().applyAlg("R'"), [{ move: "R", t: 15000 }]) };

describe("Result manual CFOP exclusion actions", () => {
  it.each(["trusted", "suspect"] as const)("marks and undoes %s analysis through Controller, retaining raw Replay", status => {
    controller.updateSolve.mockClear();
    const reviewed = { ...solve, analysis: { ...solve.analysis!, quality: { status, issues: [] } } };
    const render = (current: Solve) => elements(SolveResult({ solve: current, solves: [current],
      onContinue: vi.fn(), onReplay: vi.fn() }));
    const button = (nodes: Element[], text: string) => nodes.find(node => node.type === "button" && node.props.children === text)!;
    let nodes = render(reviewed);
    button(nodes, "Mark CFOP wrong").props.onClick();
    expect(controller.updateSolve).toHaveBeenLastCalledWith(solve.id, { cfopAnalysisExcluded: true });
    nodes = render({ ...reviewed, cfopAnalysisExcluded: true });
    expect(nodes.some(node => node.type === "button" && node.props.children === "Tools")).toBe(false);
    expect(button(nodes, "Review").props.disabled).not.toBe(true);
    button(nodes, "Undo CFOP exclusion").props.onClick();
    expect(controller.updateSolve).toHaveBeenLastCalledWith(solve.id, { cfopAnalysisExcluded: undefined });
    expect(button(render(reviewed), "Review").props.title).toBe(status === "suspect" ? "Replay the solve" : "Replay the solve, step by step, with better ways to have done each step");
  });
});

it("opens an attempt through presentation and shows/undoes the effective correction through Controller", () => {
  const onAttemptCorrection = vi.fn();
  const original: Solve = { ...solve, analysis: { ...solve.analysis!, quality: { status: "suspect", issues: [] } } };
  const before = elements(SolveResult({ solve: original, solves: [original], onContinue: vi.fn(), onReplay: vi.fn(), onAttemptCorrection }));
  before.find(node => node.type === "button" && node.props.children === "Attempt correction")!.props.onClick();
  expect(onAttemptCorrection).toHaveBeenCalledExactlyOnceWith(original);
  const correctedAnalysis = { ...original.analysis!, tps: 3.14, quality: { status: "trusted" as const, issues: [] } };
  const accepted: Solve = { ...original, cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 1, analysis: correctedAnalysis } };
  const after = elements(SolveResult({ solve: accepted, solves: [accepted], onContinue: vi.fn(), onReplay: vi.fn(), onAttemptCorrection }));
  expect(after.find(node => node.type === SolveAnalysisReview)!.props.analysis).toBe(correctedAnalysis);
  expect(after.some(node => node.type === "button" && node.props.children === "Attempt correction")).toBe(false);
  after.find(node => node.type === "button" && node.props.children === "Undo correction")!.props.onClick();
  expect(controller.clearCfopCorrection).toHaveBeenCalledExactlyOnceWith(original.id);
  expect(accepted.analysis).toBe(original.analysis);
});
