import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { SolveActions } from "./SolveActions";
import { ANALYSIS_VERSION, type SolveAnalysis } from "../../../cube/analysis";
import type { Solve } from "../../../app/types";

const analysis = { method: "CFOP", analysisVersion: ANALYSIS_VERSION, quality: { status: "suspect", issues: [] } } as unknown as SolveAnalysis;
const solve: Solve = { id: "s", sessionId: "s", createdAt: 0, rawMs: 1000, penalty: "none", source: "smartcube", scramble: "R", moves: [{ move: "R'", t: 1000 }], analysis };
const props = { onUpdate: vi.fn(), onReplay: vi.fn(), onSolveAgain: vi.fn(), onDelete: vi.fn(), onAttemptCorrection: vi.fn(), onUndoCorrection: vi.fn() };
const render = (current: Solve) => renderToStaticMarkup(<SolveActions {...props} solve={current} />);
type Element = ReactElement<Record<string, any>>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("shared Result/Statistics Delete requires explicit confirmation: %s", async confirmed => {
  const confirm = vi.fn(() => confirmed); vi.stubGlobal("window", { confirm });
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const tree = SolveActions({ ...props, solve, onDelete });
  elements(tree).find(element => element.props.children === "Delete")!.props.onClick();
  expect(confirm).toHaveBeenCalledExactlyOnceWith("Permanently delete this Solve? This cannot be undone.");
  expect(onDelete).toHaveBeenCalledTimes(confirmed ? 1 : 0);
});
it("handles a rejected deletion whose caller reports persistence failure", async () => {
  vi.stubGlobal("window", { confirm: () => true });
  const onDelete = vi.fn().mockRejectedValue(new Error("Deletion aborted"));
  const tree = SolveActions({ ...props, solve, onDelete });
  elements(tree).find(element => element.props.children === "Delete")!.props.onClick();
  await Promise.resolve(); await Promise.resolve();
  expect(onDelete).toHaveBeenCalledOnce();
});
it("offers Attempt for uncertain/missing/excluded interpretations, without cluttering trusted solves", () => {
  expect(render(solve)).toContain("Attempt correction");
  expect(render({ ...solve, analysis: undefined })).toContain("Attempt correction");
  const trusted = { ...analysis, quality: { status: "trusted" as const, issues: [] } };
  expect(render({ ...solve, analysis: trusted })).not.toContain("Attempt correction");
  expect(render({ ...solve, analysis: trusted, cfopAnalysisExcluded: true })).toContain("Attempt correction");
  expect(render({ ...solve, moves: [] })).not.toContain("Attempt correction");
  expect(render({ ...solve, scramble: "" })).not.toContain("Attempt correction");
});
it("replaces Attempt with Undo after acceptance and keeps the manual exclusion action", () => {
  const html = render({ ...solve, cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 1, analysis } });
  expect(html).toContain("Undo correction");
  expect(html).not.toContain("Attempt correction");
  expect(html).toContain("Mark CFOP wrong");
  expect(html).toContain("Review");
});
