/** Generation-only SpeedCubeDB HTML mechanics, shared with the Basic algorithm bank. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { F2L_SLOTS, f2lAlgSolves } from "../src/cube/algBank";
import { F2L_POSITIONS, F2L_POSITION_TO_FRONT_RIGHT, type F2lPosition } from "../src/cube/f2lCases";

export async function fetchSpeedCubeDbPage(url: string, cacheFile: string | null = null): Promise<string> {
  if (cacheFile && existsSync(cacheFile)) return readFileSync(cacheFile, "utf8");
  const response = await fetch(url, { headers: { "user-agent": "cubetimer alg bank builder" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const html = await response.text();
  if (cacheFile) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, html);
  }
  return html;
}

/** Parse numeric data-t case/tab blocks; ignore the nonnumeric placeholder block. */
export function parseSpeedCubeDbAlgorithmTabs(html: string): Map<string, string[][]> {
  const blocks = [...html.matchAll(/data-t="([^",]+),(\d+)"/g)];
  const byCase = new Map<string, string[][]>();
  for (const [index, block] of blocks.entries()) {
    const [, caseName, tab] = block;
    const from = block.index! + block[0].length;
    const to = index + 1 < blocks.length ? blocks[index + 1].index! : html.length;
    const algs = [...html.slice(from, to).matchAll(/<div class="formatted-alg">([^<]*)<\/div>/g)]
      .map((match) => match[1].replace(/\s+/g, " ").trim());
    const tabs = byCase.get(caseName) ?? [];
    tabs[Number(tab)] = algs;
    byCase.set(caseName, tabs);
  }
  return byCase;
}

/** Original Basic behavioural vote: a tab's rotation is established by known 41 cases. */
export function slotRotations(kpuzzle: KPuzzle, byCase: Map<string, string[][]>): number[] | null {
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

export function speedCubeDbF2lPositions(kpuzzle: KPuzzle, basicTabs: Map<string, string[][]>): F2lPosition[] {
  const rotations = slotRotations(kpuzzle, basicTabs);
  if (!rotations) throw new Error("Cannot establish SpeedCubeDB position tabs from Basic F2L");
  return rotations.map((turns) => {
    const turn = kpuzzle.algToTransformation(new Alg("y ".repeat(turns).trim()));
    const position = F2L_POSITIONS.find((candidate) =>
      turn.isIdentical(kpuzzle.algToTransformation(new Alg(F2L_POSITION_TO_FRONT_RIGHT[candidate]))));
    if (!position) throw new Error(`Unknown Basic tab rotation y${turns}`);
    return position;
  });
}
