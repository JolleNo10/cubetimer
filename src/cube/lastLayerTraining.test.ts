import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { isSolvedPattern } from "./analysis";
import type { SolveStep } from "./analysis";
import { isF2lSolved } from "./algBank";
import { lastLayerCornersOriented, reframe, withCentresHome } from "./recognise";
import { OLL_TRAINING_CASES, PLL_TRAINING_CASES } from "./algBank.generated";
import { patternToFacelets } from "./model";
import { get3x3x3 } from "./puzzle";
import {
  buildLastLayerCatalogueTarget,
  buildExactLastLayerTarget,
  isLastLayerTrainingComplete,
  lastLayerCaseCatalogue,
} from "./lastLayerTraining";

const kpuzzle = await get3x3x3();

function applyReference(target: ReturnType<typeof buildLastLayerCatalogueTarget>, alg: string) {
  const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
  const handTarget = reframe(kpuzzle, target.pattern, rotation);
  return withCentresHome(kpuzzle, reframe(kpuzzle, handTarget.applyAlg(new Alg(alg)), rotation.invert()));
}

function trainingFrame(target: ReturnType<typeof buildLastLayerCatalogueTarget>, pattern = target.pattern) {
  return withCentresHome(
    kpuzzle,
    reframe(kpuzzle, pattern, new Alg(target.info.trainingRotation.tokens.join(" "))),
  );
}

describe("generated last-layer catalogue", () => {
  it("contains every source case exactly once", () => {
    expect(Object.keys(OLL_TRAINING_CASES)).toHaveLength(57);
    expect(Object.keys(PLL_TRAINING_CASES)).toHaveLength(21);
    expect(new Set(Object.values(OLL_TRAINING_CASES).map((item) => item.id)).size).toBe(57);
    expect(new Set(Object.values(PLL_TRAINING_CASES).map((item) => item.id)).size).toBe(21);
  });

  it("builds every OLL case for all AUFs and validates references", () => {
    for (const item of lastLayerCaseCatalogue("oll")) {
      for (const auf of [0, 1, 2, 3] as const) {
        const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", item.id.replace("OLL ", ""), auf);
        expect(isF2lSolved(trainingFrame(target)), item.id).toBe(true);
        expect(isLastLayerTrainingComplete(target.info, target.pattern), item.id).toBe(false);
        for (const reference of target.info.references) {
          expect(isLastLayerTrainingComplete(target.info, applyReference(target, reference.alg)), `${item.id} #${reference.rank}`).toBe(true);
        }
      }
    }
  });

  it("builds every PLL case for all AUFs and requires the final alignment", () => {
    for (const item of lastLayerCaseCatalogue("pll")) {
      for (const auf of [0, 1, 2, 3] as const) {
        const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", item.id, auf);
        expect(isF2lSolved(trainingFrame(target)), item.id).toBe(true);
        expect(isLastLayerTrainingComplete(target.info, target.pattern), item.id).toBe(false);
        for (const reference of target.info.references) {
          const solved = applyReference(target, reference.alg);
          expect(isLastLayerTrainingComplete(target.info, solved), `${item.id} #${reference.rank}`).toBe(true);
          expect(isSolvedPattern(trainingFrame(target, solved)), `${item.id} #${reference.rank}`).toBe(true);
        }
      }
    }
  });

  it("keeps OLL distinct from PLL completion", () => {
    const oll = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", 0);
    const unsolvedPll = buildLastLayerCatalogueTarget(kpuzzle, "pll", "T", 0);
    expect(isLastLayerTrainingComplete(oll.info, unsolvedPll.pattern)).toBe(true);
    const oriented = applyReference(oll, oll.info.references[0].alg);
    const orientedFrame = trainingFrame(oll, oriented);
    expect(lastLayerCornersOriented(orientedFrame)).toBe(true);
    expect(isLastLayerTrainingComplete(oll.info, oriented)).toBe(true);
    expect(isSolvedPattern(orientedFrame)).toBe(true);

    const pllSolved = applyReference(unsolvedPll, unsolvedPll.info.references[0].alg);
    expect(isLastLayerTrainingComplete(unsolvedPll.info, pllSolved.applyMove("U"))).toBe(false);
  });

  it.each([
    ["oll", "27", "OLL"] as const,
    ["pll", "T", "PLL"] as const,
  ])("preserves the historical %s AUF", (family, caseId, stepName) => {
    const source = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 2);
    const solve = {
      id: `historical-${family}`,
      scramble: "",
      scrambledFacelets: patternToFacelets(source.pattern),
      moves: [],
      analysis: { crossFace: "U" as const },
    };
    const step = {
      name: stepName,
      case: caseId,
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as SolveStep;

    const exact = buildExactLastLayerTarget(kpuzzle, solve, step);

    expect(exact.info.auf).toBe(2);
    expect(exact.info.origin).toMatchObject({ kind: "solve-step", stepName });
    for (const reference of exact.info.references) {
      expect(isLastLayerTrainingComplete(exact.info, applyReference(exact, reference.alg))).toBe(true);
    }
  });
});
