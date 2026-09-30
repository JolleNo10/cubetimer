/** Rebuild: node node_modules/vite-node/vite-node.mjs --script scripts/fetchAdvancedF2l.ts [--cache DIR] [--check] */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { F2L_POSITIONS, type F2lPosition } from "../src/cube/f2lCases";
import { buildF2lCatalogueTarget, crossSolved, isF2lTrainingComplete, referenceExecutionSignature, referenceSolvesTarget } from "../src/cube/f2lTraining";
import type { AdvancedF2lCase, AdvancedF2lVariant } from "../src/cube/f2lTrainingCases";
import { get3x3x3 } from "../src/cube/puzzle";
import { ALL_ORIENTATIONS } from "../src/cube/orientation";
import { fetchSpeedCubeDbPage, parseSpeedCubeDbAlgorithmTabs, speedCubeDbF2lPositions } from "./speedcubedb";

export const ADVANCED_F2L_URL = "https://speedcubedb.com/a/3x3/AdvancedF2L";
const OUTPUT = new URL("../src/cube/advancedF2lCases.generated.ts", import.meta.url);
export const ADVANCED_F2L_GROUPS = ["Trapped Corner", "Trapped Edge", "Both Pieces Trapped"] as const;
export const EXPECTED_ADVANCED_F2L_NAMES = [
  ...Array.from({ length: 42 }, (_, i) => `AF2L ${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `AF2L ${i + 1}a`),
];
type SourceCase = { name: string; group: string; tabs: string[][] };

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
    const tabs = tabsByCase.get(name);
    assert(tabs && tabs.length === 4, `Missing position tab for ${name}`);
    for (let tab = 0; tab < 4; tab++) {
      assert(tabs[tab]?.length, `Empty algorithm list for ${name}, tab ${tab}`);
      for (const algorithm of tabs[tab]) {
        assert(algorithm, `Empty algorithm for ${name}, tab ${tab}`);
        new Alg(algorithm);
      }
    }
    return { name, group: group!, tabs: tabs.map((list) => [...new Set(list)]) };
  });
  assert.equal(new Set(cases.map((entry) => entry.name)).size, 54, "Duplicate Advanced names");
  assert.deepEqual(cases.map((entry) => entry.name).sort(), [...EXPECTED_ADVANCED_F2L_NAMES].sort(), "Advanced case IDs changed");
  for (const group of ADVANCED_F2L_GROUPS) {
    assert.equal(cases.filter((entry) => entry.group === group).length, 18, `Unexpected ${group} count`);
  }
  return cases;
}

/** Use only this position's source solutions. Maximize accepted references, ties keep source rank. */
export function generateAdvancedF2lVariant(kpuzzle: KPuzzle, name: string, position: F2lPosition, source: readonly string[]): AdvancedF2lVariant {
  let best: AdvancedF2lVariant | null = null;
  const outerAnchors: { anchor: string; setup: string }[] = [];
  const otherAnchors: { anchor: string; setup: string }[] = [];
  for (const anchor of source) {
    const algorithm = new Alg(anchor);
    const signature = referenceExecutionSignature(anchor);
    if (signature?.length) {
      outerAnchors.push({ anchor, setup: new Alg(signature.join(" ")).invert().toString() });
      continue;
    }
    // Some source tabs contain only wide/slice solutions. Keep those exact moves,
    // removing only their final whole-cube orientation before inverting them.
    // This does not broaden smart-cube execution signatures or synthesize a solution.
    const executed = kpuzzle.defaultPattern().applyAlg(algorithm);
    const centres = kpuzzle.defaultPattern().patternData.CENTERS.pieces;
    const correction = ALL_ORIENTATIONS.find((rotation) => executed
      .applyAlg(new Alg(rotation.tokens.join(" "))).patternData.CENTERS.pieces
      .every((piece, i) => piece === centres[i]));
    assert(correction, `Cannot normalize source anchor ${name} ${position}: ${anchor}`);
    otherAnchors.push({ anchor, setup: algorithm.concat(new Alg(correction.tokens.join(" "))).invert().toString() });
  }
  // Prefer outer-face fixed executions; use rotation-normalized slice/wide data
  // only when this tab cannot yield an eligible outer-face starting state.
  for (const candidates of [outerAnchors, otherAnchors]) {
    for (const { anchor, setup } of candidates) {
      const variant = { setup, algorithms: source };
      const variants = Object.fromEntries(F2L_POSITIONS.map((p) => [p, variant])) as AdvancedF2lCase["variants"];
      const target = buildF2lCatalogueTarget(kpuzzle, { library: "advanced", name, group: "Advanced F2L", variants }, position);
      if (!crossSolved(target.pattern, "U") || isF2lTrainingComplete(target, target.pattern)) continue;
      if (isF2lTrainingComplete({ goal: { ...target.goal, protectedSlots: [] } }, target.pattern)) continue;
      if (!referenceSolvesTarget({ kpuzzle, targetPattern: target.pattern, trainingRotation: target.info.trainingRotation, goal: target.goal, algorithm: anchor })) continue;
      const algorithms = source.filter((algorithm) => referenceSolvesTarget({
        kpuzzle, targetPattern: target.pattern, trainingRotation: target.info.trainingRotation,
        goal: target.goal, algorithm,
      }));
      if (algorithms.length > (best?.algorithms.length ?? 0)) best = { setup, algorithms };
    }
    if (best) break;
  }
  assert(best, `No valid fixed-hand anchor for ${name} ${position}`);
  return best;
}

export function generateAdvancedF2lCases(kpuzzle: KPuzzle, source: SourceCase[], positions: readonly F2lPosition[]): AdvancedF2lCase[] {
  assert.equal(positions.length, 4);
  assert.equal(new Set(positions).size, 4);
  return source.map(({ name, group, tabs }) => {
    const variants = {} as AdvancedF2lCase["variants"];
    for (const [tab, position] of positions.entries()) {
      const variant = generateAdvancedF2lVariant(kpuzzle, name, position, tabs[tab]);
      variants[position] = variant;
      for (const algorithm of tabs[tab]) {
        if (!variant.algorithms.includes(algorithm)) console.warn(`Rejected source reference ${name} ${position}: ${algorithm}`);
      }
    }
    return { name, group, variants };
  });
}

export function renderAdvancedF2lCases(cases: readonly AdvancedF2lCase[], fetched: string): string {
  const algorithms = cases.reduce((n, entry) => n + F2L_POSITIONS.reduce((m, p) => m + entry.variants[p].algorithms.length, 0), 0);
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
  const [basic, advanced] = await Promise.all([
    fetchSpeedCubeDbPage("https://speedcubedb.com/a/3x3/F2L", cache ? join(cache, "F2L.html") : null),
    fetchSpeedCubeDbPage(ADVANCED_F2L_URL, cache ? join(cache, "AdvancedF2L.html") : null),
  ]);
  const kpuzzle = await get3x3x3();
  const positions = speedCubeDbF2lPositions(kpuzzle, parseSpeedCubeDbAlgorithmTabs(basic));
  console.log(`Basic-validated source tabs: ${positions.join(", ")}`);
  const cases = generateAdvancedF2lCases(kpuzzle, parseAdvancedF2lPage(advanced), positions);
  const checkedSource = args.includes("--check") ? readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : null;
  const fetched = checkedSource ? /"fetched":"([^"]+)"/.exec(checkedSource)?.[1] : new Date().toISOString().slice(0, 10);
  assert(fetched, "Missing source fetch date");
  const generated = renderAdvancedF2lCases(cases, fetched);
  if (checkedSource) {
    assert.equal(checkedSource, generated, "Advanced source is stale; regenerate it");
    console.log("Advanced source is current (54 cases / 216 position variants).");
  } else {
    writeFileSync(OUTPUT, generated, "utf8");
    console.log("Generated 54 Advanced cases / 216 position variants.");
  }
}
