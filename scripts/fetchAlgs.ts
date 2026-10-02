/**
 * Rebuild the algorithm bank from speedcubedb.
 *
 *   npx vite-node scripts/fetchAlgs.ts
 *   npx vite-node scripts/fetchAlgs.ts -- --cache /tmp/scdb   # reuse fetched pages
 *
 * Three pages, fetched once. Everything they yield is checked against a real cube
 * before it is written: an algorithm filed under OLL 33 has to actually solve OLL 33
 * with the first two layers still standing, and an F2L algorithm filed under the back
 * left slot has to actually put the pair in the back left slot. Anything that fails is
 * reported and dropped, so a page that changes shape underneath us fails loudly rather
 * than quietly poisoning the bank.
 *
 * The output is committed. Nothing fetches at runtime — the app works offline.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Alg } from "cubing/alg";
import {
  F2L_SLOTS,
  f2lAlgSolves,
  isF2lSolved,
  ollCaseSolvedBy,
  pllCaseSolvedBy,
} from "../src/cube/algBank";
import { get3x3x3 } from "../src/cube/puzzle";
import { recogniseOll, recognisePll, withCentresHome } from "../src/cube/recognise";
import {
  fetchSpeedCubeDbPage,
  parseSpeedCubeDbAlgorithmTabs as parse,
  parseSpeedCubeDbCaseMetadata,
  slotRotations,
} from "./speedcubedb";

const BASE = "https://www.speedcubedb.com/a/3x3";
const OUTPUT = "src/cube/algBank.generated.ts";

const args = process.argv.slice(2);
const cacheDir = args.includes("--cache")
  ? args[args.indexOf("--cache") + 1]
  : null;

async function page(family: string): Promise<string> {
  const cached = cacheDir ? join(cacheDir, `${family}.html`) : null;
  if (cached && existsSync(cached)) {
    console.log(`  ${family}: reusing ${cached}`);
    return fetchSpeedCubeDbPage(`${BASE}/${family}`, cached);
  }
  const url = `${BASE}/${family}`;
  console.log(`  ${family}: fetching ${url}`);
  return fetchSpeedCubeDbPage(url, cached);
}

const kpuzzle = await get3x3x3();
const rejected: string[] = [];

/** Keep the algorithms that really do solve the case they are filed under. */
function verify(
  algs: readonly string[],
  label: string,
  solves: (alg: string) => boolean,
): string[] {
  const kept = algs.filter((alg) => {
    if (solves(alg)) return true;
    rejected.push(`${label}: ${alg}`);
    return false;
  });
  return [...new Set(kept)];
}

console.log("Fetching:");
const [ollHtml, pllHtml, f2lHtml] = await Promise.all([
  page("OLL"),
  page("PLL"),
  page("F2L"),
]);

console.log("\nChecking OLL...");
const oll: Record<string, string[]> = {};
for (const [name, slots] of parse(ollHtml)) {
  const number = /^OLL (\d+)$/.exec(name)?.[1];
  if (!number) continue;
  const kept = verify(slots[0] ?? [], name, (alg) =>
    ollCaseSolvedBy(kpuzzle, alg) === number,
  );
  if (kept.length > 0) oll[number] = kept;
}

const ollMetadata = parseSpeedCubeDbCaseMetadata(ollHtml);
const pllMetadata = parseSpeedCubeDbCaseMetadata(pllHtml);
function assertMetadataComplete(
  metadata: Map<string, { group: string; setup: string }>,
  expected: readonly string[],
  family: string,
): void {
  const expectedSet = new Set(expected);
  if (metadata.size !== expectedSet.size || [...metadata.keys()].some((id) => !expectedSet.has(id))) {
    throw new Error(`Expected exactly ${expectedSet.size} distinct ${family} setups, found ${metadata.size}.`);
  }
  for (const id of expected) {
    const entry = metadata.get(id);
    if (!entry?.group || !entry.setup) throw new Error(`Missing ${family} source metadata for ${id}.`);
  }
}
assertMetadataComplete(ollMetadata, Array.from({ length: 57 }, (_, index) => `OLL ${index + 1}`), "OLL");
const verifySetup = (setup: string, expected: string, family: "OLL" | "PLL"): boolean => {
  try {
    const pattern = withCentresHome(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg(setup)));
    if (!isF2lSolved(pattern)) return false;
    return family === "OLL"
      ? recogniseOll(kpuzzle, pattern) === expected
      : recognisePll(kpuzzle, pattern) === expected;
  } catch {
    return false;
  }
};

const ollTraining: Record<string, { id: string; group: string; setup: string; algorithms: string[] }> = {};
for (let number = 1; number <= 57; number++) {
  const id = `OLL ${number}`;
  const metadata = ollMetadata.get(id);
  if (!metadata || !verifySetup(metadata.setup, String(number), "OLL")) {
    throw new Error(`Published setup for ${id} is missing or does not identify ${id}.`);
  }
  const algorithms = oll[String(number)] ?? [];
  if (algorithms.length === 0) throw new Error(`No validated algorithms for ${id}.`);
  ollTraining[String(number)] = { id, group: metadata.group, setup: metadata.setup, algorithms };
}

console.log("Checking PLL...");
const pll: Record<string, string[]> = {};
for (const [name, slots] of parse(pllHtml)) {
  if (!/^[A-Z][a-z]?$/.test(name)) continue;
  const kept = verify(slots[0] ?? [], name, (alg) =>
    pllCaseSolvedBy(kpuzzle, alg) === name,
  );
  if (kept.length > 0) pll[name] = kept;
}

const pllTraining: Record<string, { id: string; group: string; setup: string; algorithms: string[] }> = {};
const pllNames = ["Aa", "Ab", "E", "F", "Ga", "Gb", "Gc", "Gd", "H", "Ja", "Jb", "Na", "Nb", "Ra", "Rb", "T", "Ua", "Ub", "V", "Y", "Z"];
assertMetadataComplete(pllMetadata, pllNames, "PLL");
for (const name of pllNames) {
  const metadata = pllMetadata.get(name);
  if (!metadata || !verifySetup(metadata.setup, name, "PLL")) {
    throw new Error(`Published setup for PLL ${name} is missing or does not identify PLL ${name}.`);
  }
  const algorithms = pll[name] ?? [];
  if (algorithms.length === 0) throw new Error(`No validated algorithms for PLL ${name}.`);
  pllTraining[name] = { id: name, group: metadata.group, setup: metadata.setup, algorithms };
}

/**
 * Work out which way round the cube each of speedcubedb's slot tabs means.
 *
 * The tabs are numbered, not named in the cube's own terms, so rather than assume the
 * order matches ours, ask the algorithms: whichever rotation makes them work is what
 * the tab meant. A tab whose answer is not the same for every case is a tab we have
 * misread, and the script says so rather than guessing.
 */
console.log("Checking F2L (this one takes a moment)...");
const f2lCases = parse(f2lHtml);
const rotations = slotRotations(kpuzzle, f2lCases);
if (!rotations) process.exit(1);
console.log(
  `  slot tabs mean: ${F2L_SLOTS.map((s, i) => `${i}=${s} (y${rotations[i]})`).join(", ")}`,
);

const f2l: Record<string, Record<string, string[]>> = {};
for (const [name, slots] of f2lCases) {
  if (!/^F2L \d+$/.test(name)) continue;
  const bySlot: Record<string, string[]> = {};
  F2L_SLOTS.forEach((slot, tab) => {
    const kept = verify(slots[tab] ?? [], `${name} ${slot}`, (alg) =>
      f2lAlgSolves(kpuzzle, name, rotations[tab], alg),
    );
    if (kept.length > 0) bySlot[slot] = kept;
  });
  if (Object.keys(bySlot).length > 0) f2l[name] = bySlot;
}

const count = (o: object) => Object.values(o).flat(2).length;
const total = count(oll) + count(pll) + Object.values(f2l).map(count).reduce((a, b) => a + b, 0);

console.log(`\nKept ${total} algorithms, rejected ${rejected.length}.`);
if (rejected.length > 0) {
  console.log("Rejected:");
  for (const line of rejected) console.log(`  ${line}`);
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

writeFileSync(
  OUTPUT,
  `/**
 * Generated by \`npx vite-node scripts/fetchAlgs.ts\`. Do not edit by hand.
 *
 * Algorithms from speedcubedb.com/a/3x3, the same source as the primary algorithm in
 * \`lastLayerCases.ts\` and \`f2lCases.ts\`. Every one of them has been run against a
 * cube and solves the case it is filed under; see \`algBank.ts\` for what that means
 * and \`algBank.test.ts\` for the same checks run over this file.
 */

/** Where these came from and when, so a stale bank can be spotted. */
export const ALG_BANK_SOURCE = {
  url: ${json(BASE)},
  fetched: ${json(new Date().toISOString().slice(0, 10))},
  algorithms: ${total},
} as const;

/** Keyed by OLL case number. */
export const OLL_ALG_BANK: Record<string, readonly string[]> = ${json(oll)};

/** Keyed by PLL case letter. */
export const PLL_ALG_BANK: Record<string, readonly string[]> = ${json(pll)};

/** Authoritative SpeedCubeDB catalogue state and source-ranked references for OLL. */
export const OLL_TRAINING_CASES = ${json(ollTraining)} as const;

/** Authoritative SpeedCubeDB catalogue state and source-ranked references for PLL. */
export const PLL_TRAINING_CASES = ${json(pllTraining)} as const;

/** Keyed by case name, then by the slot the pair goes into. */
export const F2L_ALG_BANK: Record<
  string,
  Partial<Record<string, readonly string[]>>
> = ${json(f2l)};
`,
);

console.log(`Wrote ${OUTPUT}.`);
