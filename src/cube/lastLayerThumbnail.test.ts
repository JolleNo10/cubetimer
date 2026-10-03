import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { patternToFacelets } from "./facelets";
import { buildLastLayerCatalogueTarget, lastLayerCaseCatalogue, lastLayerTrainingVariants, type LastLayerTrainingSet, type LastLayerTrainingTarget } from "./lastLayerTraining";
import { reframe } from "./recognise";
import { getLastLayerThumbnailModel, type LastLayerThumbnailModel } from "./lastLayerThumbnail";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

function catalogueModel(family: "oll" | "pll", caseId: string, trainingSet: LastLayerTrainingSet = "full") {
  const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, trainingSet);
  return getLastLayerThumbnailModel(family, target.pattern, target.info.trainingRotation, target.info.completionGoal);
}

function allStickers(model: LastLayerThumbnailModel) {
  return [...model.top, ...model.back, ...model.right, ...model.front, ...model.left];
}

function normalizedRecognition(target: LastLayerTrainingTarget): string {
  const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
  const hand = reframe(kpuzzle, target.pattern, rotation);
  return ["", "U", "U2", "U'"].map((auf) => {
    const pattern = reframe(kpuzzle, hand.applyAlg(new Alg(auf)), rotation.invert());
    const model = getLastLayerThumbnailModel(target.info.family, pattern, target.info.trainingRotation, target.info.completionGoal);
    // PLL recognition concerns matching corner colours. Normalize the side
    // colour names as well as AUF so equivalent display frames compare equally.
    const colours = new Map<string, number>();
    return allStickers(model).map((colour) => {
      if (colour === "D" || colour === "grey") return colour;
      if (!colours.has(colour)) colours.set(colour, colours.size);
      return colours.get(colour);
    }).join(",");
  }).sort()[0];
}

describe("last-layer thumbnail display frame", () => {
  it.each([
    ["oll", "1"],
    ["oll", "27"],
    ["pll", "Aa"],
    ["pll", "E"],
  ] as const)("physically turns %s %s into the yellow-top Training grip", (family, caseId) => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0);
    expect(patternToFacelets(target.pattern)[4]).toBe("U");
    const model = getLastLayerThumbnailModel(family, target.pattern, target.info.trainingRotation);
    expect(model.top[4]).toBe("D");
    expect(model.top).toHaveLength(9);
    for (const ring of [model.back, model.right, model.front, model.left]) {
      expect(ring).toHaveLength(3);
    }
    expect(allStickers(model)).toHaveLength(21);
  });

  it("uses the supplied display rotation rather than assuming the standard grip", () => {
    const model = getLastLayerThumbnailModel("pll", kpuzzle.defaultPattern(), { tokens: ["x"] });
    expect(model.top).toEqual(Array(9).fill("F"));
  });

  it.each(["Aa", "E"])("extracts the top-down ring from the physically rotated PLL %s", (caseId) => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", caseId, 0);
    const displayed = patternToFacelets(
      target.pattern.applyAlg(new Alg(target.info.trainingRotation.tokens.join(" "))),
    );
    const model = getLastLayerThumbnailModel("pll", target.pattern, target.info.trainingRotation);

    // Kociemba face rows are read looking straight at each face. The top-down
    // diagram reverses B and R, but keeps F and L in face-view order.
    expect(model.top).toEqual(displayed.slice(0, 9).split(""));
    expect(model.back).toEqual(displayed.slice(45, 48).split("").reverse());
    expect(model.right).toEqual(displayed.slice(9, 12).split("").reverse());
    expect(model.front).toEqual(displayed.slice(18, 21).split(""));
    expect(model.left).toEqual(displayed.slice(36, 39).split(""));
  });
});

describe("last-layer thumbnail teaching semantics", () => {
  it("masks all ignored OLL corners while keeping Dot/I/L distinct by edges", () => {
    const models = ["Dot Shape", "I-Shape", "L-Shape"].map((id) => catalogueModel("oll", id, "2look"));
    for (const model of models) {
      expect([0, 2, 6, 8].map((index) => model.top[index])).toEqual(Array(4).fill("grey"));
      expect(model.top[4]).toBe("D");
      for (const ring of [model.back, model.right, model.front, model.left]) {
        expect([ring[0], ring[2]]).toEqual(["grey", "grey"]);
      }
      expect(allStickers(model).filter((sticker) => sticker === "D")).toHaveLength(5);
    }
    expect(new Set(models.map((model) => JSON.stringify(allStickers(model)))).size).toBe(3);
  });

  it("masks PLL side edges while keeping Diagonal/Headlights distinct by corners", () => {
    const models = ["Diagonal", "Headlights"].map((id) => catalogueModel("pll", id, "2look"));
    for (const model of models) {
      expect(model.top).toEqual(Array(9).fill("D"));
      for (const ring of [model.back, model.right, model.front, model.left]) {
        expect(ring[1]).toBe("grey");
        expect(ring[0]).not.toBe("grey");
        expect(ring[2]).not.toBe("grey");
      }
    }
    expect(allStickers(models[0])).not.toEqual(allStickers(models[1]));
  });

  it.each(["oll", "pll"] as const)("does not expose the downstream %s state on first-look cards", (family) => {
    for (const item of lastLayerCaseCatalogue(family, "2look").filter((item) => item.completionGoal === "orient-edges" || item.completionGoal === "permute-corners")) {
      const target = buildLastLayerCatalogueTarget(kpuzzle, family, item.caseId, 0, "2look");
      const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
      const withoutDownstream = reframe(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg(item.algorithms[0]).invert()), rotation.invert());
      expect(normalizedRecognition({ ...target, pattern: withoutDownstream })).toEqual(normalizedRecognition(target));
    }
  });

  it.each([["oll", "Dot Shape"], ["pll", "Headlights"]] as const)("keeps %s %s recognition stable across Full variants", (family, caseId) => {
    const representative = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, "2look");
    const expected = normalizedRecognition(representative);
    const variants = lastLayerTrainingVariants(kpuzzle, family, caseId, "2look");
    expect(variants.length).toBeGreaterThan(1);
    const facelets = new Set<string>();
    for (const variant of variants) {
      for (const auf of [0, 1, 2, 3] as const) {
        const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, auf, "2look", variant.id);
        facelets.add(patternToFacelets(target.pattern));
        expect(normalizedRecognition(target), `${variant.id} AUF ${auf}`).toBe(expected);
      }
    }
    expect(facelets.size).toBeGreaterThan(4);
    expect(catalogueModel(family, caseId, "2look")).toEqual(getLastLayerThumbnailModel(family, representative.pattern, representative.info.trainingRotation, representative.info.completionGoal));
  });

  it.each([["oll", "Sune"], ["pll", "Ua"]] as const)("keeps the existing %s semantics for second-look %s", (family, caseId) => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0, "2look");
    expect(catalogueModel(family, caseId, "2look")).toEqual(getLastLayerThumbnailModel(family, target.pattern, target.info.trainingRotation));
  });

  it("shows OLL 1 and OLL 27 as distinct yellow/grey orientation diagrams", () => {
    const dot = catalogueModel("oll", "1");
    const sune = catalogueModel("oll", "27");
    for (const model of [dot, sune]) {
      expect(new Set(allStickers(model))).toEqual(new Set(["D", "grey"]));
      expect(model.top[4]).toBe("D");
      expect(allStickers(model).filter((sticker) => sticker === "D")).toHaveLength(9);
    }
    expect(dot.top.filter((sticker) => sticker === "D")).toHaveLength(1);
    expect(sune.top.filter((sticker) => sticker === "D")).toHaveLength(6);
    expect(allStickers(dot)).not.toEqual(allStickers(sune));
  });

  it("keeps PLL Aa and E fully yellow on top with distinct real-colour rings", () => {
    const aa = catalogueModel("pll", "Aa");
    const e = catalogueModel("pll", "E");
    for (const model of [aa, e]) {
      expect(model.top).toEqual(Array(9).fill("D"));
      const ring = [...model.back, ...model.right, ...model.front, ...model.left];
      expect(new Set(ring)).toEqual(new Set(["B", "R", "F", "L"]));
      expect(ring).not.toContain("grey");
    }
    expect(allStickers(aa).slice(9)).not.toEqual(allStickers(e).slice(9));
  });
});
