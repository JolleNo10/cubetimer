import { Alg } from "cubing/alg";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADVANCED_F2L_GROUPS, EXPECTED_ADVANCED_F2L_NAMES, generateAdvancedF2lVariant, parseAdvancedF2lPage, renderAdvancedF2lCases } from "../../scripts/fetchAdvancedF2l";
import { speedCubeDbF2lPositions } from "../../scripts/speedcubedb";
import { ADVANCED_F2L_CASES, ADVANCED_F2L_SOURCE } from "./advancedF2lCases.generated";
import { F2L_POSITIONS } from "./f2lCases";
import { F2L_TRAINING_CATALOGUES } from "./f2lTrainingCases";
import { buildF2lCatalogueTarget, crossSolved, isF2lTrainingComplete, referenceSolvesTarget } from "./f2lTraining";
import { get3x3x3 } from "./puzzle";
import { reframe } from "./recognise";

const kpuzzle = await get3x3x3();
const cases = F2L_TRAINING_CATALOGUES.advanced.cases;

describe("Advanced source-derived training", () => {
  it("contains precisely the 54 expected IDs in three groups of 18", () => {
    expect(cases).toHaveLength(54);
    expect(cases.map((entry) => entry.name).sort()).toEqual([...EXPECTED_ADVANCED_F2L_NAMES].sort());
    expect(new Set(cases.map((entry) => entry.name)).size).toBe(54);
    expect([...new Set(cases.map((entry) => entry.group))]).toEqual([...ADVANCED_F2L_GROUPS]);
    for (const group of ADVANCED_F2L_GROUPS) {
      expect(cases.filter((entry) => entry.group === group)).toHaveLength(18);
    }
  });

  it.each(cases.flatMap((entry) => F2L_POSITIONS.map((position) => [entry.name, position] as const)))(
    "%s %s starts incomplete with intact cross and ordered, validated references",
    (name, position) => {
      const entry = cases.find((candidate) => candidate.name === name)!;
      expect(Object.keys(entry.variants)).toEqual([...F2L_POSITIONS]);
      const variant = entry.variants[position];
      expect(variant.setup.length).toBeGreaterThan(0);
      expect(() => new Alg(variant.setup)).not.toThrow();
      expect(variant.algorithms.length).toBeGreaterThan(0);
      expect(new Set(variant.algorithms).size).toBe(variant.algorithms.length);
      const target = buildF2lCatalogueTarget(kpuzzle, entry, position);
      expect(crossSolved(target.pattern, "U")).toBe(true);
      expect(isF2lTrainingComplete(target, target.pattern)).toBe(false);
      expect(isF2lTrainingComplete({ goal: { ...target.goal, protectedSlots: [] } }, target.pattern)).toBe(false);
      expect(target.info.origin).toEqual({ kind: "catalog", library: "advanced", caseName: entry.name, group: entry.group });
      expect(target.info.position).toBe(position);
      expect(target.info.slot).toBe(({ FR: "FL", FL: "FR", BL: "BR", BR: "BL" } as const)[position]);
      expect(target.info.references).toHaveLength(variant.algorithms.length);
      variant.algorithms.forEach((algorithm, index) => {
        expect(() => new Alg(algorithm)).not.toThrow();
        expect(referenceSolvesTarget({ kpuzzle, targetPattern: target.pattern,
          trainingRotation: target.info.trainingRotation, goal: target.goal, algorithm })).toBe(true);
        const reference = target.info.references[index];
        expect(reference.rank).toBe(index + 1);
        expect(kpuzzle.algToTransformation(new Alg(reference.alg)).isIdentical(
          kpuzzle.algToTransformation(new Alg(algorithm)))).toBe(true);
      });
    },
  );

  it("gives AF2L 3 Front Left its own incomplete, solvable source state", () => {
    const source = ["L' U' L2 U2 L'", "L' U2 L2 U' L'"];
    const variant = generateAdvancedF2lVariant(kpuzzle, "AF2L 3", "FL", source);
    const target = buildF2lCatalogueTarget(kpuzzle, {
      library: "advanced", name: "AF2L 3", group: "Trapped Corner",
      variants: { FR: variant, FL: variant, BL: variant, BR: variant },
    }, "FL");
    expect(target.info.slot).toBe("FR");
    expect(variant.algorithms[0]).toBe(source[0]);
    expect(isF2lTrainingComplete(target, target.pattern)).toBe(false);
    const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
    for (const algorithm of variant.algorithms) {
      const solved = reframe(kpuzzle, reframe(kpuzzle, target.pattern, rotation)
        .applyAlg(new Alg(algorithm)), rotation.invert());
      expect(isF2lTrainingComplete(target, solved)).toBe(true);
    }
  });

  it("checks in deterministic data without network-dependent tests", () => {
    const source = renderAdvancedF2lCases(ADVANCED_F2L_CASES, ADVANCED_F2L_SOURCE.fetched);
    expect(renderAdvancedF2lCases(ADVANCED_F2L_CASES, ADVANCED_F2L_SOURCE.fetched)).toBe(source);
    expect(readFileSync(new URL("./advancedF2lCases.generated.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")).toBe(source);
  });

  it("establishes shuffled source tabs from Basic behaviour, not numeric order", () => {
    const positions = ["BL", "FR", "BR", "FL"] as const;
    const tabs = new Map(F2L_TRAINING_CATALOGUES.basic.cases.map((entry) => [
      entry.name, positions.map((position) => [...entry.algorithms[position]]),
    ]));
    expect(speedCubeDbF2lPositions(kpuzzle, tabs)).toEqual([...positions]);
  });

  it("rejects anchors for an already-solved target or broken cross", () => {
    expect(() => generateAdvancedF2lVariant(kpuzzle, "invalid tab", "FR", ["U", "F"]))
      .toThrow("No valid fixed-hand anchor for invalid tab FR");
  });

  it("preserves source rank on tied anchors and reports only compatible references", () => {
    const algorithms = ["L' U' L2 U2 L'", "L' U2 L2 U' L'"];
    const variant = generateAdvancedF2lVariant(kpuzzle, "AF2L 3", "FL", algorithms);
    expect(variant.setup).toBe(new Alg(algorithms[0]).invert().toString());
    expect(variant.algorithms).toEqual([algorithms[0]]);
  });

  it("prefers the eligible anchor that retains the most same-tab alternatives", () => {
    const isolated = "R U R'";
    const compatible = ["R U' R'", "R U' R' U"];
    const variant = generateAdvancedF2lVariant(kpuzzle, "anchor ranking", "FR", [isolated, ...compatible]);
    expect(variant.setup).toBe(new Alg(compatible[0]).invert().toString());
    expect(variant.algorithms).toEqual(compatible);
  });

  it("rejects changed case counts, malformed groups, missing tabs and invalid notation", () => {
    const fixture = EXPECTED_ADVANCED_F2L_NAMES.map((name) => {
      const number = Number(/^AF2L (\d+)/.exec(name)![1]);
      const group = number <= 9 ? "Trapped Corner" : number <= 24 ? "Trapped Edge" : "Both Pieces Trapped";
      return `<a data-alg="${name}"></a><div data-filter="${group}"></div>` +
        [0, 1, 2, 3].map((tab) => `<div data-t="${name},${tab}"><div class="formatted-alg">R U R'</div></div>`).join("");
    }).join("");
    expect(parseAdvancedF2lPage(fixture)).toHaveLength(54);
    expect(() => parseAdvancedF2lPage("")).toThrow("Expected 54");
    expect(() => parseAdvancedF2lPage(fixture.replace('data-filter="Trapped Corner"', 'data-filter="Other"'))).toThrow("Unexpected group");
    expect(() => parseAdvancedF2lPage(fixture.replace('data-t="AF2L 1,0"', 'data-t="missing,0"'))).toThrow("Expected 216");
    expect(() => parseAdvancedF2lPage(fixture.replace("R U R'", "invalid!"))).toThrow();
  });
});
