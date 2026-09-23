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
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  F2L_SLOTS,
  f2lAlgSolves,
  ollCaseSolvedBy,
  pllCaseSolvedBy,
} from "../src/cube/algBank";
import { get3x3x3 } from "../src/cube/puzzle";

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
    return readFileSync(cached, "utf8");
  }
  const url = `${BASE}/${family}`;
  console.log(`  ${family}: fetching ${url}`);
  const response = await fetch(url, {
    headers: { "user-agent": "cubetimer alg bank builder" },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const html = await response.text();
  if (cached) {
    mkdirSync(cacheDir!, { recursive: true });
    writeFileSync(cached, html);
  }
  return html;
}

/**
 * Pull the algorithms out of a page, grouped by the case and slot they sit under.
 *
 * Each block of algorithms is introduced by `data-t="<case>,<slot>"`, which is the
 * only structure relied on. The page also carries one placeholder block whose name is
 * not a case at all; requiring a numeric slot filters it out.
 */
function parse(html: string): Map<string, string[][]> {
  const blocks = [...html.matchAll(/data-t="([^",]+),(\d+)"/g)];
  const byCase = new Map<string, string[][]>();

  for (const [index, block] of blocks.entries()) {
    const [, caseName, slot] = block;
    const from = block.index + block[0].length;
    const to = index + 1 < blocks.length ? blocks[index + 1].index : html.length;
    const algs = [
      ...html.slice(from, to).matchAll(/<div class="formatted-alg">([^<]*)<\/div>/g),
    ].map((match) => match[1].replace(/\s+/g, " ").trim());

    const slots = byCase.get(caseName) ?? [];
    slots[Number(slot)] = algs;
    byCase.set(caseName, slots);
  }
  return byCase;
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

console.log("Checking PLL...");
const pll: Record<string, string[]> = {};
for (const [name, slots] of parse(pllHtml)) {
  if (!/^[A-Z][a-z]?$/.test(name)) continue;
  const kept = verify(slots[0] ?? [], name, (alg) =>
    pllCaseSolvedBy(kpuzzle, alg) === name,
  );
  if (kept.length > 0) pll[name] = kept;
}

/**
 * Work out which way round the cube each of speedcubedb's slot tabs means.
 *
 * The tabs are numbered, not named in the cube's own terms, so rather than assume the
 * order matches ours, ask the algorithms: whichever rotation makes them work is what
 * the tab meant. A tab whose answer is not the same for every case is a tab we have
 * misread, and the script says so rather than guessing.
 */
function slotRotations(byCase: Map<string, string[][]>): number[] | null {
  const votes = F2L_SLOTS.map(() => new Map<number, number>());
  for (const [name, slots] of byCase) {
    if (!/^F2L \d+$/.test(name)) continue;
    slots.forEach((algs, tab) => {
      if (tab >= F2L_SLOTS.length) return;
      for (const alg of algs ?? []) {
        for (let turns = 0; turns < 4; turns++) {
          if (!f2lAlgSolves(kpuzzle, name, turns, alg)) continue;
          votes[tab].set(turns, (votes[tab].get(turns) ?? 0) + 1);
        }
      }
    });
  }
  const chosen = votes.map((tally) => {
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : -1;
  });
  if (chosen.some((turns) => turns < 0) || new Set(chosen).size !== 4) {
    console.error("  could not pin the slot tabs down:", votes);
    return null;
  }
  return chosen;
}

console.log("Checking F2L (this one takes a moment)...");
const f2lCases = parse(f2lHtml);
const rotations = slotRotations(f2lCases);
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

/** Keyed by case name, then by the slot the pair goes into. */
export const F2L_ALG_BANK: Record<
  string,
  Partial<Record<string, readonly string[]>>
> = ${json(f2l)};
`,
);

console.log(`Wrote ${OUTPUT}.`);
