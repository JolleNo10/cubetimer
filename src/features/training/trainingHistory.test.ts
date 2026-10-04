import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../../cube/puzzle";
import { buildF2lCatalogueTarget } from "../../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../../cube/f2lTrainingCases";
import { buildLastLayerCatalogueTarget } from "../../cube/lastLayerTraining";
import * as db from "../../infrastructure/persistence/db";
import { createTrainingAttempt, loadTrainingAttempts, saveTrainingAttempt } from "./trainingHistory";
import type { CompletedTrainingAttempt, TrainingResult } from "./TrainingRuntime";

const kpuzzle = await get3x3x3();
const result: TrainingResult = { moves: ["R", "U"], stm: 2, caseTimeMs: null, elapsedMs: 700, recommendedStm: 2,
  recommendedAlg: "catalogue authority", matchedReferenceRank: 1, delta: 0 };
afterEach(() => vi.restoreAllMocks());

describe("TrainingHistory completion projection", () => {
  it("persists Drill activity and complete case timing without changing move span", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", 0).info;
    expect(createTrainingAttempt({ activity: "drill", mode: "virtual", target, result: { ...result, caseTimeMs: 2700 } }))
      .toMatchObject({ activity: "drill", mode: "virtual", caseTimeMs: 2700, elapsedMs: 700 });
  });
  it("creates a stable ID and timestamp, snapshots actual moves, and omits catalogue authority and Session identity", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const fact: CompletedTrainingAttempt = { activity: "single", mode: "virtual", result,
      target: buildF2lCatalogueTarget(kpuzzle, F2L_TRAINING_CATALOGUES.basic.cases[0], "FL").info };
    const record = createTrainingAttempt(fact);
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.createdAt).toBe(1234);
    expect(record.target).toEqual({ family: "f2l", origin: "catalog", library: "basic", caseName: "F2L 1", position: "FL" });
    expect(record.moves).toEqual(result.moves);
    expect(record.moves).not.toBe(result.moves);
    expect(record).not.toHaveProperty("recommendedAlg");
    expect(record).not.toHaveProperty("sessionId");
    expect(record).not.toHaveProperty("eventId");
  });

  it("preserves exact historical identity without assigning a catalogue", () => {
    const base = buildF2lCatalogueTarget(kpuzzle, F2L_TRAINING_CATALOGUES.basic.cases[0]).info;
    const record = createTrainingAttempt({ activity: "single", mode: "setup", result,
      target: { ...base, origin: { kind: "solve-step", solveId: "history", stepName: "F2L Slot 2", slot: "FR" } } });
    expect(record.target).toMatchObject({ family: "f2l", origin: "solve-step", solveId: "history", stepName: "F2L Slot 2", recognizedCaseName: base.references[0].caseName });
    expect(record.target).not.toHaveProperty("library");
  });

  it.each(["oll", "pll"] as const)("retains catalogue set/AUF and exact Full identity for %s", family => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, family, family === "oll" ? "27" : "T", 2).info;
    const record = createTrainingAttempt({ activity: "single", mode: "virtual", result, target });
    expect(record.target).toEqual({ family, origin: "catalog", trainingSet: "full", caseId: target.caseId, auf: 2 });
    const exact = createTrainingAttempt({ activity: "single", mode: "virtual", result,
      target: { ...target, origin: { kind: "solve-step", solveId: "source", stepName: family === "oll" ? "OLL" : "PLL" } } });
    expect(exact.target).toMatchObject({ origin: "solve-step", solveId: "source", trainingSet: "full" });
  });

  it("loads/saves through the adapter, reusing the record ID and propagating errors", async () => {
    const record = createTrainingAttempt({ activity: "single", mode: "setup", result,
      target: buildLastLayerCatalogueTarget(kpuzzle, "oll", "27").info });
    const save = vi.spyOn(db, "saveTrainingAttempt").mockResolvedValue();
    vi.spyOn(db, "loadTrainingAttempts").mockResolvedValue([record]);
    await saveTrainingAttempt(record); await saveTrainingAttempt(record);
    expect(save.mock.calls).toEqual([[record], [record]]);
    expect(await loadTrainingAttempts()).toEqual([record]);
    save.mockRejectedValue(new Error("disk full"));
    await expect(saveTrainingAttempt(record)).rejects.toThrow("disk full");
  });
});
