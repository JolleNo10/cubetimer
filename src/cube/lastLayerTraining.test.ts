import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { isSolvedPattern } from "./analysis";
import type { SolveStep } from "./analysis";
import { isF2lSolved } from "./algBank";
import { lastLayerCornersOriented, lastLayerCornersPermuted, lastLayerEdges, reframe, withCentresHome } from "./recognise";
import { OLL_TRAINING_CASES, PLL_TRAINING_CASES } from "./algBank.generated";
import { patternToFacelets } from "./model";
import { get3x3x3 } from "./puzzle";
import { algBetween } from "./solver";
import {
  resolveLastLayerTrainingReference,
  buildLastLayerCatalogueTarget,
  buildExactLastLayerTarget,
  isLastLayerTrainingComplete,
  lastLayerCaseCatalogue,
  lastLayerTrainingVariants,
} from "./lastLayerTraining";

const kpuzzle = await get3x3x3();

function expectCentresHome(target: ReturnType<typeof buildLastLayerCatalogueTarget>) {
  expect(target.pattern.patternData.CENTERS.pieces, `${target.info.family} ${target.info.caseId} AUF ${target.info.auf}`)
    .toEqual(kpuzzle.defaultPattern().patternData.CENTERS.pieces);
}

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
        expectCentresHome(target);
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
        expectCentresHome(target);
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

  it.each([
    ["oll", "39"] as const,
    ["pll", "E"] as const,
  ])("builds solver-safe %s %s targets from rotation-bearing setups at every AUF", async (family, caseId) => {
    const source = kpuzzle.defaultPattern();
    for (const auf of [0, 1, 2, 3] as const) {
      const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, auf);
      expectCentresHome(target);
      const setup = await algBetween(source, target.pattern);
      expect(patternToFacelets(source.applyAlg(setup)), `${family} ${caseId} AUF ${auf}`)
        .toBe(patternToFacelets(target.pattern));
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
    expect(exact.info.trainingSet).toBe("full");
    expect(exact.info.completionGoal).toBe(family === "oll" ? "orient-last-layer" : "solve-cube");
    expect(exact.info.origin).toMatchObject({ kind: "solve-step", stepName });
    for (const reference of exact.info.references) {
      expect(isLastLayerTrainingComplete(exact.info, applyReference(exact, reference.alg))).toBe(true);
    }
  });
});

describe("J Perm 2-Look catalogue", () => {
  it("projects all Full OLL edge-orientation states into complete, disjoint first-look pools", () => {
    const firstLooks = [["Dot Shape", "dot"], ["I-Shape", "opposite"], ["L-Shape", "adjacent"]] as const;
    const needingEdges = lastLayerCaseCatalogue("oll").filter((item) =>
      lastLayerEdges(trainingFrame(buildLastLayerCatalogueTarget(kpuzzle, "oll", item.caseId))) !== "cross",
    ).map((item) => item.caseId);
    const covered: string[] = [];
    for (const [caseId, arrangement] of firstLooks) {
      const variants = lastLayerTrainingVariants(kpuzzle, "oll", caseId, "2look");
      const expected = lastLayerCaseCatalogue("oll").filter((item) =>
        lastLayerEdges(trainingFrame(buildLastLayerCatalogueTarget(kpuzzle, "oll", item.caseId))) === arrangement,
      ).map((item) => item.caseId);
      expect(variants.map((variant) => variant.underlyingFullCaseId)).toEqual(expected);
      expect(variants.length).toBeGreaterThan(1);
      expect(new Set(variants.map((variant) => variant.id)).size).toBe(variants.length);
      covered.push(...expected);
    }
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered.sort()).toEqual(needingEdges.sort());
  });

  it("partitions every non-EPLL Full case by the J Perm corner algorithm that succeeds", () => {
    const firstLooks = lastLayerCaseCatalogue("pll", "2look").filter((item) => item.completionGoal === "permute-corners");
    const pools = firstLooks.map((item) => ({
      ...item,
      variants: lastLayerTrainingVariants(kpuzzle, "pll", item.caseId, "2look"),
    }));
    for (const pool of pools) {
      expect(pool.variants.length).toBeGreaterThan(1);
      expect(new Set(pool.variants.map((item) => item.id)).size).toBe(pool.variants.length);
    }
    const covered = pools.flatMap((pool) => pool.variants.map((item) => item.underlyingFullCaseId));
    expect(new Set(covered).size).toBe(covered.length);
    const excluded: string[] = [];
    for (const item of lastLayerCaseCatalogue("pll")) {
      const full = buildLastLayerCatalogueTarget(kpuzzle, "pll", item.caseId);
      const goal = { ...full.info, completionGoal: "permute-corners" as const };
      const aufs = ["", "U", "U2", "U'"];
      const cornersAlreadyPermuted = aufs.some((auf) => isLastLayerTrainingComplete(goal, applyReference(full, auf)));
      const membership = pools.filter((pool) => pool.variants.some((variant) => variant.underlyingFullCaseId === item.caseId));
      if (cornersAlreadyPermuted) {
        excluded.push(item.caseId);
        expect(membership, item.caseId).toHaveLength(0);
        continue;
      }
      expect(membership, item.caseId).toHaveLength(1);
      const successful = firstLooks.filter((firstLook) => aufs.some((before) => aufs.some((after) =>
        isLastLayerTrainingComplete(goal, applyReference(full, `${before} ${firstLook.algorithms[0]} ${after}`)),
      ))).map((firstLook) => firstLook.caseId);
      expect(successful, item.caseId).toEqual([membership[0].caseId]);
    }
    expect(excluded.sort()).toEqual(["H", "Ua", "Ub", "Z"]);
    expect(covered.slice().sort()).toEqual(lastLayerCaseCatalogue("pll").map((item) => item.caseId).filter((caseId) => !excluded.includes(caseId)).sort());
  });

  it("excludes generated Z's AUF-offset corners without weakening exact completion", () => {
    const z = buildLastLayerCatalogueTarget(kpuzzle, "pll", "Z");
    const goal = { ...z.info, completionGoal: "permute-corners" as const };
    expect(lastLayerCornersPermuted(trainingFrame(z))).toBe(false);
    expect(isLastLayerTrainingComplete(goal, z.pattern)).toBe(false);
    expect(["U", "U2", "U'"].some((auf) => isLastLayerTrainingComplete(goal, applyReference(z, auf)))).toBe(true);
    for (const caseId of ["Diagonal", "Headlights"]) {
      expect(lastLayerTrainingVariants(kpuzzle, "pll", caseId, "2look").map((item) => item.underlyingFullCaseId)).not.toContain("Z");
    }
  });

  it("includes required final PLL AUF in the executable reference and STM", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", "Headlights", 0, "2look", "Aa");
    const reference = target.info.references[0];
    const core = lastLayerCaseCatalogue("pll", "2look").find((item) => item.caseId === "Headlights")!.algorithms[0];
    expect(reference.alg).toBe(`U' ${core} U2`);
    expect(reference.auf).toBe(1);
    expect(reference.stm).toBe(16);
    expect(isLastLayerTrainingComplete(target.info, applyReference(target, `U' ${core}`))).toBe(false);
    expect(isLastLayerTrainingComplete(target.info, applyReference(target, reference.alg))).toBe(true);
  });

  it.each([
    ["oll", { "1: Edges": ["Dot Shape", "I-Shape", "L-Shape"], "2: Corners": ["Antisune", "H", "L", "Pi", "Sune", "T", "U"] }],
    ["pll", { "1: Corners": ["Diagonal", "Headlights"], "2: Edges": ["H", "Ua", "Ub", "Z"] }],
  ] as const)("contains the exact named %s groups with unique identities", (family, expected) => {
    const catalogue = lastLayerCaseCatalogue(family, "2look");
    expect(catalogue).toHaveLength(family === "oll" ? 10 : 6);
    expect(new Set(catalogue.map((item) => item.caseId)).size).toBe(catalogue.length);
    expect(Object.fromEntries(Object.keys(expected).map((group) => [group, catalogue.filter((item) => item.group === group).map((item) => item.name)]))).toEqual(expected);
    expect(lastLayerCaseCatalogue(family, "full")).toHaveLength(family === "oll" ? 57 : 21);
  });

  it.each(["oll", "pll"] as const)("builds every %s stage for all four AUFs", (family) => {
    for (const item of lastLayerCaseCatalogue(family, "2look")) {
      for (const auf of [0, 1, 2, 3] as const) {
        const target = buildLastLayerCatalogueTarget(kpuzzle, family, item.caseId, auf, "2look");
        expectCentresHome(target);
        expect(target.info).toMatchObject({ trainingSet: "2look", group: item.group, completionGoal: item.completionGoal });
        expect(isF2lSolved(trainingFrame(target)), item.name).toBe(true);
        expect(isLastLayerTrainingComplete(target.info, target.pattern), item.name).toBe(false);
        expect(target.info.references).toHaveLength(1);
        const reference = target.info.references[0];
        expect(reference.alg).toContain(item.algorithms[0]);
        const after = applyReference(target, reference.alg);
        const checked = trainingFrame(target, after);
        expect(isLastLayerTrainingComplete(target.info, after), item.name).toBe(true);
        expect(isF2lSolved(checked)).toBe(true);
        if (target.info.completionGoal === "orient-edges") {
          expect(lastLayerEdges(checked)).toBe("cross");
          expect(lastLayerEdges(trainingFrame(target))).toBe(item.caseId === "Dot Shape" ? "dot" : item.caseId === "I-Shape" ? "opposite" : "adjacent");
        } else if (target.info.completionGoal === "permute-corners") {
          expect(lastLayerCornersOriented(checked)).toBe(true);
          expect(lastLayerEdges(checked)).toBe("cross");
          expect(lastLayerCornersPermuted(checked)).toBe(true);
          expect(isLastLayerTrainingComplete(target.info, after.applyAlg(new Alg("D")))).toBe(false);
        }
      }
    }
  });

  it.each(["Dot Shape", "I-Shape", "L-Shape"])("validates every %s Full variant at every physical AUF", (caseId) => {
    const variants = lastLayerTrainingVariants(kpuzzle, "oll", caseId, "2look");
    const fallback = buildLastLayerCatalogueTarget(kpuzzle, "oll", caseId, 0, "2look");
    expect(patternToFacelets(fallback.pattern)).toBe(patternToFacelets(buildLastLayerCatalogueTarget(kpuzzle, "oll", caseId, 0, "2look", variants[0].id).pattern));
    for (const variant of variants) {
      for (const auf of [0, 1, 2, 3] as const) {
        const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", caseId, auf, "2look", variant.id);
        expectCentresHome(target);
        const full = buildLastLayerCatalogueTarget(kpuzzle, "oll", variant.underlyingFullCaseId!, auf);
        expect(patternToFacelets(target.pattern)).toBe(patternToFacelets(full.pattern));
        expect(target.info).toMatchObject({ caseId, trainingSet: "2look", completionGoal: "orient-edges", auf });
        expect(isF2lSolved(trainingFrame(target)), variant.id).toBe(true);
        expect(isLastLayerTrainingComplete(target.info, target.pattern), variant.id).toBe(false);
        expect(target.info.references).toHaveLength(1);
        const after = applyReference(target, target.info.references[0].alg);
        expect(isLastLayerTrainingComplete(target.info, after), `${variant.id} AUF ${auf}`).toBe(true);
      }
    }
  });

  it.each(["Diagonal", "Headlights"])("validates every %s Full variant and exact corner completion at every AUF", (caseId) => {
    for (const variant of lastLayerTrainingVariants(kpuzzle, "pll", caseId, "2look")) {
      for (const auf of [0, 1, 2, 3] as const) {
        const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", caseId, auf, "2look", variant.id);
        expectCentresHome(target);
        const full = buildLastLayerCatalogueTarget(kpuzzle, "pll", variant.underlyingFullCaseId!, auf);
        expect(patternToFacelets(target.pattern)).toBe(patternToFacelets(full.pattern));
        const checked = trainingFrame(target);
        expect(isF2lSolved(checked), variant.id).toBe(true);
        expect(lastLayerEdges(checked), variant.id).toBe("cross");
        expect(lastLayerCornersOriented(checked), variant.id).toBe(true);
        expect(lastLayerCornersPermuted(checked), variant.id).toBe(false);
        expect(isLastLayerTrainingComplete(target.info, target.pattern), variant.id).toBe(false);
        expect(target.info.references).toHaveLength(1);
        const reference = target.info.references[0];
        expect(reference.alg).toContain(lastLayerCaseCatalogue("pll", "2look").find((item) => item.caseId === caseId)!.algorithms[0]);
        expect(isLastLayerTrainingComplete(target.info, applyReference(target, reference.alg)), `${variant.id} AUF ${auf}`).toBe(true);
      }
    }
  });

  it("requires F2L, orientation, and exact corner alignment for the corner-permutation goal", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", "Headlights", 0, "2look");
    const completed = applyReference(target, target.info.references[0].alg);
    const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
    for (const move of ["U", "R", "R U R' U R U2 R'"]) {
      const invalid = reframe(kpuzzle, trainingFrame(target, completed).applyAlg(new Alg(move)), rotation.invert());
      expect(isLastLayerTrainingComplete(target.info, invalid), move).toBe(false);
    }
  });
});


describe("personal last-layer references", () => {
  it.each([0, 1, 2, 3] as const)("keeps stable OLL source across target AUF %s", auf => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", auf);
    const zero = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27", 0);
    expect(target.info.references.map(r => r.sourceAlg)).toEqual(zero.info.references.map(r => r.sourceAlg));
    expect(target.info.references.map(r => r.rank)).toEqual(zero.info.references.map(r => r.rank));
    const resolved = resolveLastLayerTrainingReference(target, zero.info.references[0].sourceAlg)!;
    expect(isLastLayerTrainingComplete(target.info, applyReference(target, resolved.alg))).toBe(true);
    if (auf !== 0) expect(resolved.alg).not.toBe(resolved.sourceAlg);
    expect(resolveLastLayerTrainingReference(target, "R")).toBeNull();
  });
  it("accepts a PLL personal recognition angle different from canonical rank 1", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", "T", 2);
    const source = `U ${target.info.references[0].sourceAlg} U'`;
    const resolved = resolveLastLayerTrainingReference(target, source)!;
    expect(resolved).not.toBeNull();
    expect(isLastLayerTrainingComplete(target.info, applyReference(target, resolved.alg))).toBe(true);
    expect(resolved.sourceAlg).toBe(source);
  });
  it("adds final AUF only when required", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", "T", 0);
    const source = target.info.references[0].sourceAlg;
    expect(resolveLastLayerTrainingReference(target, source)?.alg).toBe(source);
    const resolved = resolveLastLayerTrainingReference(target, `${source} U`)!;
    expect(isLastLayerTrainingComplete(target.info, applyReference(target, resolved.alg))).toBe(true);
    expect(resolved.alg).toMatch(/U'$/);
  });
});
