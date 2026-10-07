/**
 * End-to-end check of case recognition in recorded solves.
 *
 * Every algorithm in the bank is turned on a cube held with its cross on each of the
 * six faces, written as the face turns a smart cube would report, and the analysis has
 * to name the case it solves. The recognisers are tested on their own elsewhere; this
 * is the question a solver actually asks of their solve.
 */
import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { analyseSolve, isTrustedCfopAnalysis, type TimedMove } from "./analysis";
import { F2L_ALG_BANK, OLL_ALG_BANK, PLL_ALG_BANK } from "./algBank.generated";
import { ADVANCED_F2L_CASES } from "./advancedF2lCases.generated";
import { F2L_POSITIONS, type F2lPosition } from "./f2lCases";
import { FACES } from "./moves";
import { rotationForCrossFace } from "./orientation";
import { physicalTurns } from "./physicalTurns";
import { get3x3x3 } from "./puzzle";
import { withCentresHome } from "./recognise";
import { f2lExecution } from "./stepExecution";

const kpuzzle = await get3x3x3();

const timed = (moves: readonly string[]): TimedMove[] =>
  moves.map((move, i) => ({ move, t: (i + 1) * 150 }));

/** Run a held-frame solution from the state it solves, cross on `face`. */
function analyseHeld(solution: string, face: (typeof FACES)[number]) {
  const { moves } = physicalTurns(solution, rotationForCrossFace(face).orientation);
  const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(moves.join(" ")).invert());
  return analyseSolve(scrambled, timed(moves), null, { observedStartBottomFace: face });
}

/**
 * A cross and four pairs to solve before the last layer, so the solve looks like one:
 * the inverse of breaking the cross with `F2 L2` and pulling each pair out with its own
 * trigger.
 */
const F2L_SOLUTION = new Alg("R U R' U' L' U' L U F U F' U' B' U' B U2 F2 L2").invert().toString();
const AUFS = ["", "U", "U2", "U'"];

describe("physicalTurns", () => {
  it("reaches the same state as the algorithm for every bank algorithm", () => {
    for (const algorithm of [...Object.values(OLL_ALG_BANK), ...Object.values(PLL_ALG_BANK)].flat()) {
      const expected = withCentresHome(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg(algorithm)));
      const actual = kpuzzle.defaultPattern().applyAlg(new Alg(physicalTurns(algorithm).moves.join(" ")));
      expect(actual.isIdentical(expected), algorithm).toBe(true);
    }
  });
});

describe("case recognition in recorded solves", () => {
  for (const face of FACES) {
    it(`names every OLL algorithm's case with the cross on ${face}, and trusts it`, () => {
      const wrong: string[] = [];
      for (const [name, algorithms] of Object.entries(OLL_ALG_BANK)) {
        algorithms.forEach((algorithm, i) => {
          const auf = AUFS[i % 4];
          const analysis = analyseHeld(`${F2L_SOLUTION} ${auf} ${algorithm}`, face);
          const oll = analysis?.steps.find((step) => step.name === "OLL");
          if (oll?.case !== name) wrong.push(`${name} ← ${algorithm}: ${oll?.case ?? "no analysis"}`);
          else if (!isTrustedCfopAnalysis(analysis)) wrong.push(`${name} ← ${algorithm}: ${JSON.stringify(analysis?.quality)}`);
        });
      }
      expect(wrong).toEqual([]);
    });

    it(`names every PLL algorithm's case with the cross on ${face}, and trusts it`, () => {
      const wrong: string[] = [];
      for (const [name, algorithms] of Object.entries(PLL_ALG_BANK)) {
        algorithms.forEach((algorithm, i) => {
          const auf = AUFS[i % 4];
          const analysis = analyseHeld(`${F2L_SOLUTION} ${auf} ${algorithm}`, face);
          const pll = analysis?.steps.find((step) => step.name === "PLL");
          if (pll?.case !== name) wrong.push(`${name} ← ${algorithm}: ${pll?.case ?? "no analysis"}`);
          else if (!isTrustedCfopAnalysis(analysis)) wrong.push(`${name} ← ${algorithm}: ${JSON.stringify(analysis?.quality)}`);
        });
      }
      expect(wrong).toEqual([]);
    });
  }

  it("finds the one-look algorithm that was executed", () => {
    const unmatched: string[] = [];
    for (const [family, bank] of [["OLL", OLL_ALG_BANK], ["PLL", PLL_ALG_BANK]] as const) {
      for (const [name, algorithms] of Object.entries(bank)) {
        for (const algorithm of algorithms) {
          const step = analyseHeld(`${F2L_SOLUTION} U ${algorithm}`, "D")?.steps.find((s) => s.name === family);
          if (step?.looks?.length !== 1 || !step.executedAlg) unmatched.push(`${name} ← ${algorithm}: ${step?.looks?.length ?? 0} looks`);
        }
      }
    }
    expect(unmatched).toEqual([]);
  });
});

/**
 * Run one F2L algorithm, after an AUF, from the state it solves with the pair belonging
 * to `position`, and read the step the way the analysis does.
 */
function executeF2l(position: F2lPosition, auf: string, algorithm: string) {
  const { moves } = physicalTurns(`${auf} ${algorithm}`);
  const patterns = [kpuzzle.defaultPattern().applyAlg(new Alg(moves.join(" ")).invert())];
  for (const move of moves) patterns.push(patterns.at(-1)!.applyMove(move));
  return f2lExecution({
    kpuzzle,
    facing: (index) => patterns[index],
    tokens: moves,
    moves: timed(moves),
    from: 0,
    to: moves.length,
    startMs: 0,
  }, position);
}

describe("F2L case recognition from what was executed", () => {
  it("names the basic case each algorithm solves, after an AUF, in every slot", () => {
    const wrong: string[] = [];
    for (const [name, positions] of Object.entries(F2L_ALG_BANK)) {
      for (const position of F2L_POSITIONS) {
        (positions[position] ?? []).forEach((algorithm, i) => {
          const execution = executeF2l(position, AUFS[i % 4], algorithm);
          if (execution.case !== name || !execution.executedAlg || execution.setupMoves !== 0) {
            wrong.push(`${name} ${position} ← ${algorithm}: ${execution.case} setup ${execution.setupMoves}${execution.executedAlg ? "" : " (no alg)"}`);
          }
        });
      }
    }
    expect(wrong).toEqual([]);
  });

  it("names an advanced case, and finds its algorithm, in every slot", () => {
    const wrong: string[] = [];
    for (const { name, algorithms } of ADVANCED_F2L_CASES) {
      for (const position of F2L_POSITIONS) {
        algorithms[position].forEach((algorithm, i) => {
          const execution = executeF2l(position, AUFS[i % 4], algorithm);
          if (!execution.case?.startsWith("AF2L") || !execution.executedAlg) {
            wrong.push(`${name} ${position} ← ${algorithm}: ${execution.case}${execution.executedAlg ? "" : " (no alg)"}`);
          }
        });
      }
    }
    expect(wrong).toEqual([]);
  });
});
