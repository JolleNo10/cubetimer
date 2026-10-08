import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "./Controller";
import { CubeModel } from "../cube/model";
import { patternToFacelets } from "../cube/facelets";
import { get3x3x3 } from "../cube/puzzle";
import { analyseSolve } from "../cube/analysis";
import { buildStateOnlyCfopAnalysis } from "../features/history/repair";
import { effectiveCfopAnalysis } from "./solveAnalysis";
import * as db from "../infrastructure/persistence/db";
import type { Solve } from "./types";

const kpuzzle = await get3x3x3();
const pll = "R U R' U' R' F R2 U' R' U' R U R' F'";
function recorded(solution = pll): Solve {
  const scramble = new Alg(solution).invert().toString();
  const moves = Array.from(new Alg(solution).expand().childAlgNodes()).map((node, i) => ({ move: node.toString(), t: (i + 1) * 200 }));
  const start = kpuzzle.defaultPattern().applyAlg(scramble);
  const analysis = analyseSolve(start, moves, null, { observedStartBottomFace: "L", trackedBottomFace: "D" });
  return { id: "correction", sessionId: "s", createdAt: 0, rawMs: moves.at(-1)!.t, source: "smartcube", penalty: "none",
    scramble, scrambledFacelets: patternToFacelets(start), moves, analysis, gripTrack: `|${"LF".repeat(moves.length)}`, solveStartBottomFace: "L" };
}
function controllerFor(solve: Solve) {
  const controller = new Controller(new CubeModel(kpuzzle));
  controller.sessions.update(state => ({ ...state, solves: [solve], lastSolve: solve }));
  return controller;
}
afterEach(() => vi.restoreAllMocks());

describe("Controller CFOP correction workflow", () => {
  it("previews without writes, applies an overlay, and undoes exactly while retaining the veto", async () => {
    const original = { ...recorded(), cfopAnalysisExcluded: true as const };
    const controller = controllerFor(original);
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    const preview = await controller.previewCfopCorrection(original.id);
    expect(preview?.analysis.quality?.status).toBe("trusted");
    expect(save).not.toHaveBeenCalled();
    expect(controller.sessions.get().lastSolve).toBe(original);
    expect(await controller.applyCfopCorrection(original.id)).toBe(true);
    const accepted = controller.sessions.get().lastSolve!;
    expect(accepted.cfopAnalysisCorrection).toMatchObject({ mode: "state-only", analysis: preview!.analysis });
    expect(accepted.cfopAnalysisCorrection?.acceptedAt).toEqual(expect.any(Number));
    expect(accepted.analysis).toBe(original.analysis);
    expect(accepted.moves).toBe(original.moves);
    expect(accepted.scramble).toBe(original.scramble);
    expect(accepted.scrambledFacelets).toBe(original.scrambledFacelets);
    expect(accepted.gripTrack).toBe(original.gripTrack);
    expect(accepted.solveStartBottomFace).toBe(original.solveStartBottomFace);
    expect(accepted.cfopAnalysisExcluded).toBe(true);
    expect(save).toHaveBeenLastCalledWith(accepted);
    await controller.clearCfopCorrection(original.id);
    const undone = controller.sessions.get().lastSolve!;
    expect(undone).toEqual(original);
    expect(undone).not.toHaveProperty("cfopAnalysisCorrection");
    expect(effectiveCfopAnalysis(undone)).toBe(original.analysis);
    expect(save).toHaveBeenLastCalledWith(undone);
  });
  it("recomputes from changed raw facts instead of persisting the stale preview", async () => {
    const original = recorded();
    const controller = controllerFor(original);
    const preview = await controller.previewCfopCorrection(original.id);
    const changed = recorded("R U R' U R U2 R'");
    controller.sessions.update(state => ({ ...state, solves: [changed], lastSolve: changed }));
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    expect(await controller.applyCfopCorrection(original.id)).toBe(true);
    const accepted = controller.sessions.get().lastSolve!;
    expect(accepted.cfopAnalysisCorrection?.analysis).toEqual(buildStateOnlyCfopAnalysis(kpuzzle, changed));
    expect(accepted.cfopAnalysisCorrection?.analysis).not.toEqual(preview!.analysis);
    expect(save).toHaveBeenCalledOnce();
  });
  it("rejects a newly ambiguous candidate without saving after a trusted preview", async () => {
    const controller = controllerFor(recorded());
    expect((await controller.previewCfopCorrection("correction"))?.analysis.quality?.status).toBe("trusted");
    const changed = recorded("R2 F2 R2 F2");
    controller.sessions.update(state => ({ ...state, solves: [changed], lastSolve: changed }));
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    expect(await controller.applyCfopCorrection(changed.id)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(controller.sessions.get().lastSolve).toBe(changed);
  });
  it("serializes correction with pending manual edits, preserving their latest veto", async () => {
    const controller = controllerFor(recorded());
    const save = vi.spyOn(db, "saveSolve").mockResolvedValue();
    await Promise.all([controller.updateSolve("correction", { cfopAnalysisExcluded: true }), controller.applyCfopCorrection("correction")]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.sessions.get().lastSolve?.cfopAnalysisExcluded).toBe(true);
    expect(controller.sessions.get().lastSolve?.cfopAnalysisCorrection).toBeDefined();
  });
  it("uses current persisted historical facts outside the active Session without switching context", async () => {
    let stored = recorded();
    const controller = new Controller(new CubeModel(kpuzzle));
    vi.spyOn(db, "loadAllSolves").mockImplementation(async () => [stored]);
    const save = vi.spyOn(db, "saveSolve").mockImplementation(async solve => { stored = solve; });
    expect((await controller.previewCfopCorrection(stored.id))?.analysis.quality?.status).toBe("trusted");
    expect(save).not.toHaveBeenCalled();
    expect(await controller.applyCfopCorrection(stored.id)).toBe(true);
    expect(stored.cfopAnalysisCorrection).toBeDefined();
    await controller.clearCfopCorrection(stored.id);
    expect(stored).toEqual(recorded());
    expect(controller.sessions.get().solves).toEqual([]);
    expect(controller.state.get().area).toBe("timer");
  });
  it("practices the effective step with corrected analysis and no historical orientation evidence", async () => {
    const recordedSolve = recorded();
    const original: Solve = { ...recordedSolve, analysis: { ...recordedSolve.analysis!, crossFace: "L" } };
    const candidate = buildStateOnlyCfopAnalysis(kpuzzle, original)!;
    const accepted: Solve = { ...original, cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 123, analysis: candidate } };
    const controller = controllerFor(accepted);
    const practice = vi.spyOn(controller.training, "practiceSolveStep").mockResolvedValue();
    await controller.practiceSolveStep(original, original.analysis!.steps[6]);
    const [input, step] = practice.mock.calls[0];
    expect(input.analysis).toBe(candidate);
    expect(input.analysis?.crossFace).toBe("D");
    expect(step).toBe(candidate.steps[6]);
    expect(input.gripTrack).toBeUndefined();
    expect(input.solveStartBottomFace).toBeUndefined();
    expect(accepted.analysis).toBe(original.analysis);
    expect(accepted.gripTrack).toBe(original.gripTrack);
    expect(accepted.solveStartBottomFace).toBe("L");
  });
});
