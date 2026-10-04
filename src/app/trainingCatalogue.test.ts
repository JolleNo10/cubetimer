import { describe, expect, it } from "vitest";
import { catalogueIdentityForTarget, normalizeTrainingCatalogueIdentity, trainingCatalogueKey } from "./trainingCatalogue";
import { trainingCaseKey } from "../features/training/trainingPerformance";
import { buildLastLayerCatalogueTarget } from "../cube/lastLayerTraining";
import { get3x3x3 } from "../cube/puzzle";

const kpuzzle = await get3x3x3();
describe("durable Training catalogue identity", () => {
  it("preserves JSON tuple encoding and separates library, position and set", () => {
    const f2l = { family: "f2l", library: "basic", position: "FR", caseName: "F2L 4" } as const;
    expect(trainingCatalogueKey(f2l)).toBe('["f2l","basic","F2L 4","FR"]');
    expect(trainingCaseKey({ ...f2l, origin: "catalog" })).toBe(trainingCatalogueKey(f2l));
    expect(trainingCatalogueKey({ ...f2l, position: "FL" })).not.toBe(trainingCatalogueKey(f2l));
    expect(trainingCatalogueKey({ ...f2l, library: "advanced" })).not.toBe(trainingCatalogueKey(f2l));
    expect(trainingCatalogueKey({ family: "oll", trainingSet: "full", caseId: "27" })).not.toBe(
      trainingCatalogueKey({ family: "oll", trainingSet: "2look", caseId: "27" }));
  });
  it("excludes randomized AUF and validates catalogue context", () => {
    const identities = ([0, 3] as const).map(auf => catalogueIdentityForTarget(buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", auf).info));
    expect(identities[0]).toEqual(identities[1]);
    expect(trainingCatalogueKey(identities[0]!)).toBe('["oll","full","27"]');
    expect(normalizeTrainingCatalogueIdentity({ family: "pll", trainingSet: "2look", caseId: "T" })).toBeNull();
    expect(normalizeTrainingCatalogueIdentity({ family: "f2l", library: "basic", position: "FR", caseName: "unknown" })).toBeNull();
  });
});
