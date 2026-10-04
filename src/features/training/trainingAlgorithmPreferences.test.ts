import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../../cube/puzzle";
import { buildF2lCatalogueTarget } from "../../cube/f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "../../cube/f2lTrainingCases";
import { buildLastLayerCatalogueTarget } from "../../cube/lastLayerTraining";
import * as db from "../../infrastructure/persistence/db";
import { catalogueIdentityForTarget } from "../../app/trainingCatalogue";
import { createTrainingAlgorithmPreference, deleteTrainingAlgorithmPreference, loadTrainingAlgorithmPreferences, normalizePersonalAlgorithm, saveTrainingAlgorithmPreference, validateTrainingAlgorithm } from "./trainingAlgorithmPreferences";

const kpuzzle = await get3x3x3();
afterEach(() => vi.restoreAllMocks());
describe("personal algorithm semantic workflow", () => {
  it.each(["basic", "advanced"] as const)("validates %s F2L against the catalogue and normalizes notes without runtime facts", library => {
    const built = buildF2lCatalogueTarget(kpuzzle, F2L_TRAINING_CATALOGUES[library].cases[0]);
    const identity = catalogueIdentityForTarget(built.info)!;
    vi.spyOn(Date, "now").mockReturnValue(100);
    const record = createTrainingAlgorithmPreference(kpuzzle, identity, built.info.references[0].sourceAlg, "custom", "  My grip  ");
    expect(record).toMatchObject({ target: identity, note: "My grip", createdAt: 100, updatedAt: 100 });
    expect(Object.keys(record).sort()).toEqual(["algorithm", "createdAt", "key", "note", "source", "target", "updatedAt"]);
    vi.mocked(Date.now).mockReturnValue(200);
    expect(createTrainingAlgorithmPreference(kpuzzle, identity, record.algorithm, "catalog", "  ", record))
      .toMatchObject({ key: record.key, createdAt: 100, updatedAt: 200, note: null });
    expect(() => validateTrainingAlgorithm(kpuzzle, identity, "R")).toThrow(/complete/);
  });
  it.each([
    ["oll", "27", "full"], ["pll", "T", "full"],
    ["oll", "L-Shape", "2look"], ["pll", "Headlights", "2look"],
  ] as const)("validates %s %s %s for every variant and AUF", (family, caseId, set) => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, set);
    expect(validateTrainingAlgorithm(kpuzzle, catalogueIdentityForTarget(target.info)!, target.info.references[0].sourceAlg))
      .toBe(target.info.references[0].sourceAlg);
    expect(() => validateTrainingAlgorithm(kpuzzle, catalogueIdentityForTarget(target.info)!, "R U")).toThrow(/every Training variant/);
  });
  it.each(["", "   ", "R ?", "R".repeat(1001), "(R)1001", "(R)100000000"])("rejects blank, invalid or excessive notation %s", input => {
    expect(() => normalizePersonalAlgorithm(input)).toThrow();
  });
  it("delegates configuration persistence", async () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27");
    const preference = createTrainingAlgorithmPreference(kpuzzle, catalogueIdentityForTarget(target.info)!, target.info.references[0].sourceAlg, "catalog");
    vi.spyOn(db, "saveTrainingAlgorithmPreference").mockResolvedValue();
    vi.spyOn(db, "deleteTrainingAlgorithmPreference").mockResolvedValue();
    vi.spyOn(db, "loadTrainingAlgorithmPreferences").mockResolvedValue([preference]);
    await saveTrainingAlgorithmPreference(preference); await deleteTrainingAlgorithmPreference(preference.key);
    expect(db.saveTrainingAlgorithmPreference).toHaveBeenCalledWith(preference);
    expect(db.deleteTrainingAlgorithmPreference).toHaveBeenCalledWith(preference.key);
    expect(await loadTrainingAlgorithmPreferences()).toEqual([preference]);
  });
});


it("editing only a canonical choice's note retains its catalog source", () => {
  const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27");
  const original = createTrainingAlgorithmPreference(kpuzzle, catalogueIdentityForTarget(target.info)!, target.info.references[0].sourceAlg, "catalog");
  expect(createTrainingAlgorithmPreference(kpuzzle, original.target, `  ${original.algorithm}  `, "custom", "new note", original))
    .toMatchObject({ algorithm: original.algorithm, source: "catalog", note: "new note", createdAt: original.createdAt });
  expect(createTrainingAlgorithmPreference(kpuzzle, original.target, target.info.references[1].sourceAlg, "custom", "new note", original).source).toBe("custom");
});
