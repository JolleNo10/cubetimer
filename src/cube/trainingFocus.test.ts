import { describe, expect, it } from "vitest";
import { get3x3x3 } from "./puzzle";
import { buildF2lCatalogueTarget } from "./f2lTraining";
import { findF2lTrainingCase } from "./f2lTrainingCases";
import { buildLastLayerCatalogueTarget } from "./lastLayerTraining";
import { trainingFocusFacelets, trainingFocusMask } from "./trainingFocus";
import { CORNER_FACELETS, EDGE_FACELETS, SOLVED_FACELETS } from "./facelets";
import { CORNER_NAMES, EDGE_NAMES } from "./moves";

const kpuzzle = await get3x3x3();
describe("Training visual focus", () => {
  it.each(["FR", "FL", "BL", "BR"] as const)("keeps solved F2L and the moving %s pair coloured, greying unrelated slot occupants", position => {
    const target = buildF2lCatalogueTarget(kpuzzle, findF2lTrainingCase("basic", "F2L 4")!, position);
    const mask = trainingFocusMask(target.info)!;
    for (const orbit of Object.values(mask.orbits)) for (const piece of orbit.pieces) expect(piece.facelets).toHaveLength(5);
    for (const pattern of [target.pattern, target.pattern.applyAlg("R U F"), kpuzzle.defaultPattern()]) {
      const visible = trainingFocusFacelets(pattern, mask);
      for (const [orbit, names, slots] of [["CORNERS", CORNER_NAMES, CORNER_FACELETS], ["EDGES", EDGE_NAMES, EDGE_FACELETS]] as const) {
        const data = pattern.patternData[orbit];
        slots.forEach((indexes, slot) => {
          const name = names[data.pieces[slot]];
          const relevant = orbit === "CORNERS" ? name.includes(target.info.crossFace) : !name.includes("D");
          expect(indexes.map(i => visible[i])).toEqual(indexes.map(() => relevant));
        });
      }
    }
    const slot = EDGE_NAMES.indexOf(target.info.slot as typeof EDGE_NAMES[number]);
    expect(EDGE_FACELETS[slot].every(i => !trainingFocusFacelets(target.pattern, mask)[i])).toBe(true);
  });
  it("keeps only OLL orientation stickers, and only edges for edge orientation", () => {
    for (const [id, set] of [["27", "full"], ["I-Shape", "2look"]] as const) {
      const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", id, 0, set);
      const mask = trainingFocusMask(target.info)!;
      const top = Object.entries(target.info.trainingRotation.orientation).find(([, position]) => position === "U")![0];
      CORNER_FACELETS.forEach((indexes, i) => expect(mask.orbits.CORNERS.pieces[i].facelets.slice(0, indexes.length)).toEqual(
        indexes.map(index => target.info.completionGoal !== "orient-edges" && SOLVED_FACELETS[index] === top ? "regular" : "ignored")));
      EDGE_FACELETS.forEach((indexes, i) => expect(mask.orbits.EDGES.pieces[i].facelets.slice(0, indexes.length)).toEqual(
        indexes.map(index => SOLVED_FACELETS[index] === top ? "regular" : "ignored")));
    }
  });
  it("retains all PLL permutation colours", () => {
    expect(trainingFocusMask(buildLastLayerCatalogueTarget(kpuzzle, "pll", "T").info)).toBeUndefined();
  });
});
