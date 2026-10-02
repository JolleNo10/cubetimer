import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { patternToFacelets } from "./facelets";
import { buildLastLayerCatalogueTarget } from "./lastLayerTraining";
import { getLastLayerThumbnailModel, type LastLayerThumbnailModel } from "./lastLayerThumbnail";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

function catalogueModel(family: "oll" | "pll", caseId: string) {
  const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0);
  return getLastLayerThumbnailModel(family, target.pattern, target.info.trainingRotation);
}

function allStickers(model: LastLayerThumbnailModel) {
  return [...model.top, ...model.back, ...model.right, ...model.front, ...model.left];
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
