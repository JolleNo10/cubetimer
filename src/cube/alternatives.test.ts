import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import { analyseSolve, type TimedMove } from "./analysis";
import { analyseSolveAlternatives } from "./alternatives";
import { isF2lSolved } from "./algBank";
import { F2L_SLOTS } from "./f2l";
import { EDGES_OF_FACE, type Face } from "./moves";
import { rotationForCrossFace } from "./orientation";
import { physicalTurns } from "./physicalTurns";
import { get3x3x3 } from "./puzzle";
import { reframe } from "./recognise";

const kpuzzle = await get3x3x3();

/** A solve of `solution`, held with the cross on `face`, from the state it solves. */
function recorded(solution: string, face: Face = "D") {
  const { moves: turns } = physicalTurns(solution, rotationForCrossFace(face).orientation);
  const moves: TimedMove[] = turns.map((move, i) => ({ move, t: (i + 1) * 200 }));
  const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(turns.join(" ")).invert());
  const analysis = analyseSolve(scrambled, moves, null, { observedStartBottomFace: face })!;
  const at = (index: number) => scrambled.applyAlg(new Alg(turns.slice(0, index).join(" ")));
  return { analysis, moves, scrambled, at };
}

/** Read a cube-frame state the way the solver held it. */
const crossDown = (pattern: KPattern, face: Face) =>
  reframe(kpuzzle, pattern, new Alg(rotationForCrossFace(face).tokens.join(" ")));

const crossIn = (pattern: KPattern) =>
  EDGES_OF_FACE.D.every((e) => pattern.patternData.EDGES.pieces[e] === e && pattern.patternData.EDGES.orientation[e] === 0);

const pairIn = (pattern: KPattern, slot: number) => {
  const { edge, corner } = F2L_SLOTS[slot];
  const { EDGES, CORNERS } = pattern.patternData;
  return EDGES.pieces[edge] === edge && EDGES.orientation[edge] === 0 && CORNERS.pieces[corner] === corner && CORNERS.orientation[corner] === 0;
};

// A solve that does the cross, then the back-right pair the long way round although
// the front-right pair was a three-mover all along, then the rest, then a T-perm.
const SOLUTION = [
  "F2 L2",
  "R' U2 R U' R' U R", // BR, the long way
  "R U R'", // FR
  "U' L' U L", // FL
  "L U L' U' L U L'", // BL
  "R U R' U' R' F R2 U' R' U' R U R' F'",
].join(" ");

const RUNS = await Promise.all((["D", "R"] as const).map(async (face) => {
  const solve = recorded(SOLUTION, face);
  const progress: number[] = [];
  const result = await analyseSolveAlternatives(kpuzzle, solve, (_, done) => progress.push(done));
  return { face, solve, progress, result };
}));

describe("analyseSolveAlternatives", () => {
  for (const { face, solve, progress, result } of RUNS) {
    describe(`with the cross on ${face}`, () => {

      it("reports progress as each part is done", () => {
        expect(progress).toEqual(Array.from({ length: solve.analysis.steps.length + 3 }, (_, i) => i + 1));
      });

      it("finds the shortest cross, and any XCross close to it does what it claims", () => {
        expect(result.grip.bottom).toBe(face);
        const best = result.cross!.best;
        expect(best.length).toBeLessThanOrEqual(2);
        expect(crossIn(crossDown(solve.scrambled.applyAlg(new Alg(best.cubeMoves.join(" "))), face))).toBe(true);
        for (const plan of [result.cross!.xcross, result.cross!.xxcross]) {
          if (!plan) continue;
          // Played on the cube as it really was, the sequence does what it says.
          const after = crossDown(solve.scrambled.applyAlg(new Alg(plan.cubeMoves.join(" "))), face);
          expect(crossIn(after)).toBe(true);
          expect(plan.pairs.every((name) => pairIn(after, F2L_SLOTS.findIndex((slot) => slot.name === name)))).toBe(true);
        }
      });

      it("offers every unsolved pair at the start of an F2L step, each with an algorithm that works", () => {
        for (const step of solve.analysis.steps.filter((s) => s.slot && s.fromMove < s.toMove)) {
          const choices = result.steps.find((s) => s.name === step.name)!.pairChoices!;
          expect(choices.filter((choice) => choice.chosen)).toHaveLength(1);
          const start = solve.at(step.fromMove);
          const keep = F2L_SLOTS.map((_, i) => i).filter((i) => pairIn(crossDown(start, face), i));
          for (const choice of choices) {
            if (!choice.best) continue;
            const after = crossDown(start.applyAlg(new Alg(choice.best.cubeMoves.join(" "))), face);
            const index = F2L_SLOTS.findIndex((slot) => slot.name === choice.position);
            expect(crossIn(after), `${step.name} ${choice.slot}`).toBe(true);
            expect(pairIn(after, index), `${step.name} ${choice.slot}`).toBe(true);
            expect(keep.every((i) => pairIn(after, i)), `${step.name} ${choice.slot}`).toBe(true);
          }
        }
      });

      it("sees that the pair done first was not the cheapest", () => {
        const first = solve.analysis.steps.find((s) => s.name === "F2L Slot 1")!;
        const choices = result.steps.find((s) => s.name === "F2L Slot 1")!.pairChoices!;
        const chosen = choices.find((choice) => choice.chosen)!;
        const cheapest = Math.min(...choices.flatMap((choice) => (choice.best ? [choice.best.length] : [])));
        expect(chosen.slot).toBe(first.slot);
        expect(cheapest).toBeLessThan(first.sliceTurns);
      });

      it("finds a pair order no longer than the one used, which really finishes F2L", () => {
        const order = result.pairOrder!;
        expect(order.length).toBeLessThanOrEqual(order.used);
        // One algorithm can put a second pair in on the way, so there may be fewer
        // parts than pairs left.
        const afterCross = crossDown(solve.at(order.fromMove), face);
        expect(order.order.length).toBeLessThanOrEqual(F2L_SLOTS.filter((_, i) => !pairIn(afterCross, i)).length);
        const after = solve.at(order.fromMove).applyAlg(new Alg(order.cubeMoves.join(" ")));
        expect(isF2lSolved(crossDown(after, face))).toBe(true);
      });

      it("gives the shortest one-look algorithm for the PLL, and it solves it", () => {
        const step = solve.analysis.steps.find((s) => s.name === "PLL")!;
        const reference = result.steps.find((s) => s.name === "PLL")!.reference!;
        expect(reference.label).toBe("PLL T");
        expect(reference.length).toBeLessThanOrEqual(15);
        const after = solve.at(step.fromMove).applyAlg(new Alg(reference.cubeMoves.join(" ")));
        expect(after.isIdentical(kpuzzle.defaultPattern())).toBe(true);
      });

      it("keeps each shorter same-result route honest", () => {
        for (const step of result.steps) {
          if (step.sameResult.best) expect(step.sameResult.bestLength).toBeLessThan(step.used);
          else expect(step.sameResult.optimal || step.sameResult.tooDeep || step.used === 0).toBe(true);
        }
      });
    });
  }
});

describe("XCross suggestions", () => {
  it("finds the XXCross a scramble leaves", async () => {
    // Undone by a single F2, which puts back the front cross edge and both front pairs.
    const solve = recorded("F2 L U L' U' R' U' R U");
    expect(solve.analysis.steps[0].toMove).toBe(1);
    const result = await analyseSolveAlternatives(kpuzzle, solve);
    expect(result.cross!.xxcross).toMatchObject({ length: 1, alg: "F2" });
    expect(result.cross!.xxcross!.pairs.sort()).toEqual(["FL", "FR"]);
  });
});
