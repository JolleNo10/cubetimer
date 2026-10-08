import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SolveActions } from "./SolveActions";
import { ANALYSIS_VERSION, type SolveAnalysis } from "../../../cube/analysis";
import type { Solve } from "../../../app/types";

const analysis = { method: "CFOP", analysisVersion: ANALYSIS_VERSION, quality: { status: "suspect", issues: [] } } as unknown as SolveAnalysis;
const solve: Solve = { id: "s", sessionId: "s", createdAt: 0, rawMs: 1000, penalty: "none", source: "smartcube", scramble: "R", moves: [{ move: "R'", t: 1000 }], analysis };
const props = { onUpdate: vi.fn(), onReplay: vi.fn(), onSolveAgain: vi.fn(), onDelete: vi.fn(), onAttemptCorrection: vi.fn(), onUndoCorrection: vi.fn() };
const render = (current: Solve) => renderToStaticMarkup(<SolveActions {...props} solve={current} />);
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
