/** Rebuild: node node_modules/vite-node/vite-node.mjs --script scripts/fetchAdvancedF2l.ts [--cache DIR] [--check] */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { F2L_POSITIONS, f2lPositionTransform, positionF2lAlgorithm, type F2lPosition } from "../src/cube/f2lCases";
import { buildF2lCatalogueTarget, crossSolved, isF2lTrainingComplete, referenceSolvesTarget } from "../src/cube/f2lTraining";
import type { AdvancedF2lCase } from "../src/cube/f2lTrainingCases";
import { get3x3x3 } from "../src/cube/puzzle";
import { fetchSpeedCubeDbPage, parseSpeedCubeDbAlgorithmTabs } from "./speedcubedb";

export const ADVANCED_F2L_URL = "https://speedcubedb.com/a/3x3/AdvancedF2L";
const OUTPUT = new URL("../src/cube/advancedF2lCases.generated.ts", import.meta.url);
export const ADVANCED_F2L_GROUPS = ["Trapped Corner", "Trapped Edge", "Both Pieces Trapped"] as const;
export const EXPECTED_ADVANCED_F2L_NAMES = [
  ...Array.from({ length: 42 }, (_, i) => `AF2L ${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `AF2L ${i + 1}a`),
];
export type SourceCase = { name: string; group: string; setup: string; tabs: string[][] };

export function parseAdvancedF2lPage(html: string): SourceCase[] {
  const headings = [...html.matchAll(/<a\b[^>]*\bdata-alg="(AF2L [^"]+)"[^>]*>/g)];
  assert.equal(headings.length, 54, "Expected 54 Advanced F2L case headings");
  const tabsByCase = parseSpeedCubeDbAlgorithmTabs(html);
  const tabKeys = [...html.matchAll(/data-t="(AF2L [^",]+,\d+)"/g)].map((match) => match[1]);
  assert.equal(tabKeys.length, 216, "Expected 216 Advanced source position tabs");
  assert.equal(new Set(tabKeys).size, 216, "Duplicate Advanced source position tabs");
  const cases = headings.map((heading, i) => {
    const name = heading[1];
    const block = html.slice(heading.index!, headings[i + 1]?.index ?? html.length);
    const group = /data-filter="([^"]+)"/.exec(block)?.[1];
    const match = /^AF2L (\d+)(a?)$/.exec(name);
    assert(match, `Malformed case name ${name}`);
    const number = Number(match[1]);
    const expectedGroup = number <= 9 ? "Trapped Corner" : number <= 24 ? "Trapped Edge" : "Both Pieces Trapped";
    assert.equal(group, expectedGroup, `Unexpected group for ${name}`);
    const setup = /class="setup-case\b[^"]*"[^>]*>\s*<div>setup:<\/div>\s*([^<]+)<\/div>/.exec(block)?.[1].trim();
    assert(setup, `Missing published setup for ${name}`);
    new Alg(setup);
    const tabs = tabsByCase.get(name);
    assert(tabs && tabs.length === 4, `Missing position tab for ${name}`);
    for (let tab = 0; tab < 4; tab++) {
      assert(tabs[tab]?.length, `Empty algorithm list for ${name}, tab ${tab}`);
      for (const algorithm of tabs[tab]) {
        assert(algorithm, `Empty algorithm for ${name}, tab ${tab}`);
        new Alg(algorithm);
      }
    }
    return { name, group: group!, setup, tabs: tabs.map((list) => [...new Set(list)]) };
  });
  assert.equal(new Set(cases.map((entry) => entry.name)).size, 54, "Duplicate Advanced names");
  assert.deepEqual(cases.map((entry) => entry.name).sort(), [...EXPECTED_ADVANCED_F2L_NAMES].sort(), "Advanced case IDs changed");
  for (const group of ADVANCED_F2L_GROUPS) {
    assert.equal(cases.filter((entry) => entry.group === group).length, 18, `Unexpected ${group} count`);
  }
  return cases;
}

/** Home-slot identity is established from the published state, never from a solution inverse. */
export function deriveCanonicalTarget(kpuzzle: KPuzzle, source: SourceCase): F2lPosition {
  const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(source.setup));
  assert(crossSolved(pattern, "D"), `${source.name}: published setup breaks the cross`);
  const unsolved = F2L_POSITIONS.filter((targetSlot) => !isF2lTrainingComplete({
    goal: { crossFace: "D", targetSlot, protectedSlots: [] },
  }, pattern));
  assert(unsolved.length === 2 && unsolved.includes("FR"), `${source.name}: expected FR plus one other unsolved slot`);
  const targetSlot = unsolved.find((slot) => slot !== "FR")!;
  const goal = { crossFace: "D" as const, targetSlot,
    protectedSlots: F2L_POSITIONS.filter((slot) => !unsolved.includes(slot)) };
  assert(source.tabs[0]?.some((algorithm) => isF2lTrainingComplete({ goal }, pattern.applyAlg(new Alg(algorithm)))),
    `${source.name}: no tab-0 reference completes canonical ${targetSlot}`);
  return targetSlot;
}

function caseTarget(kpuzzle: KPuzzle, source: SourceCase, canonicalTarget: F2lPosition, position: F2lPosition) {
  const algorithms = { FR: [], FL: [], BL: [], BR: [] };
  const target = buildF2lCatalogueTarget(kpuzzle, { ...source, library: "advanced", canonicalTarget, algorithms }, position);
  assert(crossSolved(target.pattern, "U"), `${source.name} ${position}: broken cross`);
  assert(!isF2lTrainingComplete({ goal: { ...target.goal, protectedSlots: [] } }, target.pattern),
    `${source.name} ${position}: target starts solved`);
  assert(!isF2lTrainingComplete(target, target.pattern), `${source.name} ${position}: training starts complete`);
  return target;
}

function solves(kpuzzle: KPuzzle, target: ReturnType<typeof caseTarget>, algorithm: string): boolean {
  return referenceSolvesTarget({ kpuzzle, targetPattern: target.pattern,
    trainingRotation: target.info.trainingRotation, goal: target.goal, algorithm });
}

/** A rotation is labelled by where it moves FR, using the shared positional geometry. */
function rotatedTarget(kpuzzle: KPuzzle, from: F2lPosition, rotation: F2lPosition): F2lPosition {
  const transform = kpuzzle.algToTransformation(f2lPositionTransform("FR", rotation));
  const to = F2L_POSITIONS.find((position) => kpuzzle.algToTransformation(f2lPositionTransform(from, position)).isIdentical(transform));
  assert(to, `Missing relative rotation ${from} ${rotation}`);
  return to;
}

/** Establish source tab rotations behaviourally across the entire catalogue, not by numeric tab order. */
export function advancedF2lTabRotations(kpuzzle: KPuzzle, source: readonly SourceCase[]): F2lPosition[] {
  assert.equal(source.length, 54, "Tab rotation validation requires all 54 cases");
  const targets = source.map((entry) => {
    const canonicalTarget = deriveCanonicalTarget(kpuzzle, entry);
    return F2L_POSITIONS.map((rotation) => caseTarget(kpuzzle, entry, canonicalTarget, rotatedTarget(kpuzzle, canonicalTarget, rotation)));
  });
  const rotations = [0, 1, 2, 3].map((tab) => {
    const candidates = F2L_POSITIONS.map((rotation, index) => {
      const counts = source.map((entry, i) => entry.tabs[tab].filter((algorithm) => solves(kpuzzle, targets[i][index], algorithm)).length);
      return { rotation, coverage: counts.filter(Boolean).length, total: counts.reduce((a, b) => a + b, 0) };
    }).filter((candidate) => candidate.coverage === 54).sort((a, b) => b.total - a.total);
    assert(candidates.length && candidates[0].total !== candidates[1]?.total, `No unambiguous global rotation for source tab ${tab}`);
    return candidates[0].rotation;
  });
  assert.equal(rotations[0], "FR", "Tab 0 must describe the published canonical orientation");
  assert.equal(new Set(rotations).size, 4, "Source tabs must cover all four whole-case rotations");
  return rotations;
}

export function generateAdvancedF2lCases(kpuzzle: KPuzzle, source: SourceCase[]): AdvancedF2lCase[] {
  const rotations = advancedF2lTabRotations(kpuzzle, source);
  console.log(`Behaviourally validated source tab rotations (FR destinations): ${rotations.join(", ")}`);
  return source.map((entry) => {
    const canonicalTarget = deriveCanonicalTarget(kpuzzle, entry);
    const algorithms = {} as AdvancedF2lCase["algorithms"];
    for (const position of F2L_POSITIONS) {
      const tab = rotations.findIndex((rotation) => rotatedTarget(kpuzzle, canonicalTarget, rotation) === position);
      assert(tab >= 0, `${entry.name} ${position}: missing source rotation`);
      const target = caseTarget(kpuzzle, entry, canonicalTarget, position);
      const candidates = [...new Set(entry.tabs[tab])];
      algorithms[position] = candidates.filter((algorithm) => solves(kpuzzle, target, algorithm));
      for (const algorithm of candidates) {
        if (!algorithms[position].includes(algorithm)) console.warn(`Rejected source reference ${entry.name} tab ${tab} ${position}: ${algorithm}`);
      }
      if (!algorithms[position].length) {
        console.warn(`Using positioned canonical references for ${entry.name} ${position}`);
        algorithms[position] = [...new Set(entry.tabs[0].filter((algorithm) =>
          solves(kpuzzle, caseTarget(kpuzzle, entry, canonicalTarget, canonicalTarget), algorithm))
          .map((algorithm) => positionF2lAlgorithm(new Alg(algorithm), canonicalTarget, position).toString()))]
          .filter((algorithm) => solves(kpuzzle, target, algorithm));
      }
      assert(algorithms[position].length, `${entry.name} ${position}: no reference solves the authoritative case`);
    }
    return { name: entry.name, group: entry.group, setup: entry.setup, canonicalTarget, algorithms };
  });
}

export function renderAdvancedF2lCases(cases: readonly AdvancedF2lCase[], fetched: string): string {
  const algorithms = cases.reduce((n, entry) => n + F2L_POSITIONS.reduce((m, p) => m + entry.algorithms[p].length, 0), 0);
  return [
    "// Generated by scripts/fetchAdvancedF2l.ts. Do not edit by hand.",
    'import type { AdvancedF2lCase } from "./f2lTrainingCases";',
    "",
    `export const ADVANCED_F2L_SOURCE = ${JSON.stringify({ url: ADVANCED_F2L_URL, fetched, cases: cases.length, algorithms })} as const;`,
    "",
    `export const ADVANCED_F2L_CASES: readonly AdvancedF2lCase[] = ${JSON.stringify(cases, null, 2)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cache = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : null;
  const advanced = await fetchSpeedCubeDbPage(ADVANCED_F2L_URL, cache ? join(cache, "AdvancedF2L.html") : null);
  const kpuzzle = await get3x3x3();
  const cases = generateAdvancedF2lCases(kpuzzle, parseAdvancedF2lPage(advanced));
  const checkedSource = args.includes("--check") ? readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : null;
  const fetched = checkedSource ? /"fetched":"([^"]+)"/.exec(checkedSource)?.[1] : new Date().toISOString().slice(0, 10);
  assert(fetched, "Missing source fetch date");
  const generated = renderAdvancedF2lCases(cases, fetched);
  if (checkedSource) {
    assert.equal(checkedSource, generated, "Advanced source is stale; regenerate it");
    console.log("Advanced source is current (54 canonical cases / 216 target positions).");
  } else {
    writeFileSync(OUTPUT, generated, "utf8");
    console.log("Generated 54 authoritative Advanced cases / 216 target positions.");
  }
}
