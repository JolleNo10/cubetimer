/**
 * Compare this app's solve analysis against the export's own, over a real export.
 *
 *   npx vite-node scripts/compareAnalysis.ts -- ~/Downloads/solves.csv 3000
 *
 * Both are given the same scramble and the same raw move stream, so any disagreement
 * is a difference of interpretation, not of data.
 */
import { readFileSync } from "node:fs";
import { Alg } from "cubing/alg";
import { analyseSolve } from "../src/cube/analysis";
import { get3x3x3 } from "../src/cube/puzzle";
import { parseSolveCsv } from "../src/state/solveCsv";

const file = process.argv[2] ?? `${process.env.HOME}/Downloads/solves.csv`;
const limit = Number(process.argv[3] ?? 2000);

const kpuzzle = await get3x3x3();
const text = readFileSync(file, "utf8");
const { solves } = parseSolveCsv(text);
console.log(`read ${solves.length} solves from ${file}`);

const tally = {
  compared: 0,
  noAnalysis: 0,
  mineNull: 0,
  crossFace: 0,
  stepBoundaries: 0,
  turnCounts: 0,
  recognition: 0,
  rotation: 0,
};
const examples: string[] = [];

for (const solve of solves.slice(0, limit)) {
  const theirs = solve.analysis;
  if (!theirs || solve.moves.length === 0) {
    tally.noAnalysis++;
    continue;
  }
  const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble));
  const mine = analyseSolve(scrambled, solve.moves);
  if (!mine) {
    tally.mineNull++;
    continue;
  }
  tally.compared++;

  if (mine.crossFace === theirs.crossFace) tally.crossFace++;
  if (mine.rotation === theirs.rotation) tally.rotation++;

  const sameBoundaries = mine.steps.every(
    (step, i) => step.cumulativeMs === theirs.steps[i]?.cumulativeMs,
  );
  if (sameBoundaries) tally.stepBoundaries++;
  else if (examples.length < 5) {
    examples.push(
      `${solve.id.slice(0, 8)} boundaries mine=[${mine.steps
        .map((s) => s.cumulativeMs)
        .join(",")}] theirs=[${theirs.steps.map((s) => s.cumulativeMs).join(",")}]`,
    );
  }

  if (
    mine.sliceTurns === theirs.sliceTurns &&
    mine.quarterTurns === theirs.quarterTurns
  ) {
    tally.turnCounts++;
  }
  if (
    sameBoundaries &&
    mine.steps.every((s, i) => s.recognitionMs === theirs.steps[i].recognitionMs)
  ) {
    tally.recognition++;
  }
}

const pct = (n: number) => `${((n / tally.compared) * 100).toFixed(1)}%`;
console.log(`
compared:          ${tally.compared}
  cross face:      ${tally.crossFace} (${pct(tally.crossFace)})
  step boundaries: ${tally.stepBoundaries} (${pct(tally.stepBoundaries)})
  turn counts:     ${tally.turnCounts} (${pct(tally.turnCounts)})
  recognition:     ${tally.recognition} (${pct(tally.recognition)})
  grip string:     ${tally.rotation} (${pct(tally.rotation)})
skipped (no data): ${tally.noAnalysis}
my analysis null:  ${tally.mineNull}`);
for (const line of examples) console.log("  " + line);
