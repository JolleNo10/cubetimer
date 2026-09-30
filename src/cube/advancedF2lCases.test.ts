import { Alg } from "cubing/alg";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADVANCED_F2L_GROUPS, EXPECTED_ADVANCED_F2L_NAMES, advancedF2lTabRotations,
  deriveCanonicalTarget, generateAdvancedF2lCases, parseAdvancedF2lPage, renderAdvancedF2lCases,
  type SourceCase } from "../../scripts/fetchAdvancedF2l";
import { speedCubeDbF2lPositions } from "../../scripts/speedcubedb";
import { ADVANCED_F2L_CASES, ADVANCED_F2L_SOURCE } from "./advancedF2lCases.generated";
import { F2L_POSITIONS, f2lPositionTransform } from "./f2lCases";
import { F2L_TRAINING_CATALOGUES } from "./f2lTrainingCases";
import { buildF2lCatalogueTarget, crossSolved, isF2lTrainingComplete, referenceSolvesTarget } from "./f2lTraining";
import { get3x3x3 } from "./puzzle";
import { reframe } from "./recognise";

const kpuzzle = await get3x3x3();
const cases = F2L_TRAINING_CATALOGUES.advanced.cases;

// Reconstitute source-tab lists from their validated rotation relationship, offline.
const source: SourceCase[] = cases.map((entry) => ({
  name: entry.name, group: entry.group, setup: entry.setup,
  tabs: F2L_POSITIONS.map((rotation) => {
    const turn = kpuzzle.algToTransformation(f2lPositionTransform("FR", rotation));
    const position = F2L_POSITIONS.find((p) => kpuzzle.algToTransformation(
      f2lPositionTransform(entry.canonicalTarget, p)).isIdentical(turn))!;
    return [...entry.algorithms[position]];
  }),
}));

describe("Advanced authoritative published cases", () => {
  it("contains precisely the 54 expected IDs in three groups of 18", () => {
    expect(cases).toHaveLength(54);
    expect(cases.map((entry) => entry.name).sort()).toEqual([...EXPECTED_ADVANCED_F2L_NAMES].sort());
    expect(new Set(cases.map((entry) => entry.name)).size).toBe(54);
    expect([...new Set(cases.map((entry) => entry.group))]).toEqual([...ADVANCED_F2L_GROUPS]);
    for (const group of ADVANCED_F2L_GROUPS) expect(cases.filter((entry) => entry.group === group)).toHaveLength(18);
    for (const position of ["BR", "BL", "FL"]) expect(cases.filter((entry) => entry.canonicalTarget === position)).toHaveLength(18);
  });

  it.each(cases)("$name derives its non-FR target from the published state and tab-0 behaviour", (entry) => {
    expect(entry.setup.length).toBeGreaterThan(0);
    expect(() => new Alg(entry.setup)).not.toThrow();
    const published = kpuzzle.defaultPattern().applyAlg(new Alg(entry.setup));
    expect(crossSolved(published, "D")).toBe(true);
    const unsolved = F2L_POSITIONS.filter((targetSlot) => !isF2lTrainingComplete({
      goal: { crossFace: "D", targetSlot, protectedSlots: [] },
    }, published));
    expect(new Set(unsolved)).toEqual(new Set(["FR", entry.canonicalTarget]));
    expect(entry.canonicalTarget).not.toBe("FR");
    expect(deriveCanonicalTarget(kpuzzle, source.find((candidate) => candidate.name === entry.name)!)).toBe(entry.canonicalTarget);
    const target = buildF2lCatalogueTarget(kpuzzle, entry, entry.canonicalTarget);
    const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
    expect(reframe(kpuzzle, target.pattern, rotation).isIdentical(published)).toBe(true);
    expect(target.info.references.length).toBeGreaterThan(0);
  });

  it.each(cases.flatMap((entry) => F2L_POSITIONS.map((position) => [entry.name, position] as const)))(
    "%s %s geometrically positions the authoritative case with ordered, validated references",
    (name, position) => {
      const entry = cases.find((candidate) => candidate.name === name)!;
      expect(Object.keys(entry.algorithms)).toEqual([...F2L_POSITIONS]);
      const algorithms = entry.algorithms[position];
      expect(algorithms.length).toBeGreaterThan(0);
      expect(new Set(algorithms).size).toBe(algorithms.length);
      const target = buildF2lCatalogueTarget(kpuzzle, entry, position);
      const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
      // Independent state expectation: reframe the exact published pattern as a whole.
      const published = kpuzzle.defaultPattern().applyAlg(new Alg(entry.setup));
      const positioned = reframe(kpuzzle, published, f2lPositionTransform(entry.canonicalTarget, position).invert());
      expect(reframe(kpuzzle, target.pattern, rotation).isIdentical(positioned)).toBe(true);
      expect(crossSolved(target.pattern, "U")).toBe(true);
      expect(isF2lTrainingComplete(target, target.pattern)).toBe(false);
      expect(isF2lTrainingComplete({ goal: { ...target.goal, protectedSlots: [] } }, target.pattern)).toBe(false);
      expect(target.info.origin).toEqual({ kind: "catalog", library: "advanced", caseName: entry.name, group: entry.group });
      expect(target.info.position).toBe(position);
      expect(target.info.slot).toBe(({ FR: "FL", FL: "FR", BL: "BR", BR: "BL" } as const)[position]);
      expect(target.info.references).toHaveLength(algorithms.length);
      algorithms.forEach((algorithm, index) => {
        expect(() => new Alg(algorithm)).not.toThrow();
        expect(referenceSolvesTarget({ kpuzzle, targetPattern: target.pattern,
          trainingRotation: target.info.trainingRotation, goal: target.goal, algorithm })).toBe(true);
        expect(target.info.references[index].rank).toBe(index + 1);
        expect(kpuzzle.algToTransformation(new Alg(target.info.references[index].alg)).isIdentical(
          kpuzzle.algToTransformation(new Alg(algorithm)))).toBe(true);
      });
    },
  );

  it("AF2L 9 and AF2L 18 target FL, not FR, without substituting the published setup", () => {
    for (const name of ["AF2L 9", "AF2L 18"]) {
      const entry = cases.find((candidate) => candidate.name === name)!;
      expect(entry.canonicalTarget).toBe("FL");
      const target = buildF2lCatalogueTarget(kpuzzle, entry, "FL");
      expect(target.info.references.length).toBeGreaterThan(0);
      expect(isF2lTrainingComplete(target, target.pattern)).toBe(false);
    }
  });

  it("establishes all four global source-tab rotations behaviourally, including shuffled tabs", () => {
    expect(advancedF2lTabRotations(kpuzzle, source)).toEqual([...F2L_POSITIONS]);
    // Tab 0 is the canonical reference set; the other tab indices are not assumed.
    const shuffled = source.map((entry) => ({ ...entry, tabs: [entry.tabs[0], entry.tabs[3], entry.tabs[1], entry.tabs[2]] }));
    expect(advancedF2lTabRotations(kpuzzle, shuffled)).toEqual(["FR", "BR", "FL", "BL"]);
    expect(() => advancedF2lTabRotations(kpuzzle, source.map((entry, i) => i ? entry :
      { ...entry, tabs: [entry.tabs[0], ["U"], entry.tabs[2], entry.tabs[3]] }))).toThrow("No unambiguous global rotation");
  });

  it("source tabs mean identity/y/y2/y-prime REFRAMES, not conjugation prefixes", () => {
    const rotations = advancedF2lTabRotations(kpuzzle, source);
    const expectedReframes = ["", "y", "y2", "y'"];
    rotations.forEach((destination, tab) => {
      // reframe(pattern, y) = y' · pattern · y. A y' setup prefix is NOT a y' reframe.
      const prefix = f2lPositionTransform("FR", destination);
      expect(kpuzzle.algToTransformation(prefix.invert()).isIdentical(
        kpuzzle.algToTransformation(new Alg(expectedReframes[tab])))).toBe(true);
    });
  });

  it("regenerates the full source-ranked catalogue deterministically without network", () => {
    expect(generateAdvancedF2lCases(kpuzzle, source)).toEqual(ADVANCED_F2L_CASES);
    const rendered = renderAdvancedF2lCases(ADVANCED_F2L_CASES, ADVANCED_F2L_SOURCE.fetched);
    expect(readFileSync(new URL("./advancedF2lCases.generated.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")).toBe(rendered);
  });

  it("keeps the existing Basic source-tab interpretation unchanged", () => {
    const positions = ["BL", "FR", "BR", "FL"] as const;
    const tabs = new Map(F2L_TRAINING_CATALOGUES.basic.cases.map((entry) => [
      entry.name, positions.map((position) => [...entry.algorithms[position]]),
    ]));
    expect(speedCubeDbF2lPositions(kpuzzle, tabs)).toEqual([...positions]);
  });

  it("rejects invalid authoritative states or missing canonical references instead of inventing states", () => {
    expect(() => deriveCanonicalTarget(kpuzzle, { ...source[0], setup: "F" })).toThrow("breaks the cross");
    expect(() => deriveCanonicalTarget(kpuzzle, { ...source[0], setup: "U" })).toThrow("FR plus one other");
    expect(() => deriveCanonicalTarget(kpuzzle, { ...source[0], tabs: [["U"], ...source[0].tabs.slice(1)] })).toThrow("no tab-0 reference");
  });

  it("parses published setups exactly and rejects malformed setups, groups, tabs and notation", () => {
    const fixture = source.map((entry) => `<a data-alg="${entry.name}"></a><div data-filter="${entry.group}"></div>` +
      `<div class="setup-case align-items-center"><div>setup:</div>${entry.setup}</div>` +
      entry.tabs.map((list, tab) => `<div data-t="${entry.name},${tab}">` +
        list.map((algorithm) => `<div class="formatted-alg">${algorithm}</div>`).join("") + "</div>").join("")).join("");
    expect(parseAdvancedF2lPage(fixture)).toEqual(source);
    expect(() => parseAdvancedF2lPage("")).toThrow("Expected 54");
    expect(() => parseAdvancedF2lPage(fixture.replace('data-filter="Trapped Corner"', 'data-filter="Other"'))).toThrow("Unexpected group");
    expect(() => parseAdvancedF2lPage(fixture.replace('data-t="AF2L 1,0"', 'data-t="missing,0"'))).toThrow("Expected 216");
    expect(() => parseAdvancedF2lPage(fixture.replace("<div>setup:</div>S R S'", "<div>setup:</div>"))).toThrow("Missing published setup");
    expect(() => parseAdvancedF2lPage(fixture.replace("<div>setup:</div>S R S'", "<div>setup:</div>invalid!"))).toThrow();
    expect(() => parseAdvancedF2lPage(fixture.replace("S R' S'", "invalid!"))).toThrow();
  });
});
