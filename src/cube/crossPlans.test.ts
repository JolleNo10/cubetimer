import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { planCross } from "./crossPlans";
import { crossSolver } from "./crossSolver";
import { EDGES_OF_FACE, f2lSlotsForCrossFace } from "./moves";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();
const PAIRS = f2lSlotsForCrossFace("D");

const randomScramble = () =>
  Array.from({ length: 20 }, () => {
    const faces = "URFDLB";
    const suffix = ["", "'", "2"];
    return (
      faces[Math.floor(Math.random() * 6)] + suffix[Math.floor(Math.random() * 3)]
    );
  }).join(" ");

const crossDone = (pattern: ReturnType<typeof kpuzzle.defaultPattern>) => {
  const edges = pattern.patternData.EDGES;
  return EDGES_OF_FACE.D.every(
    (slot) => edges.pieces[slot] === slot && edges.orientation[slot] === 0,
  );
};

const pairDone = (
  pattern: ReturnType<typeof kpuzzle.defaultPattern>,
  name: string,
) => {
  const pair = PAIRS.find((p) => p.name === name)!;
  const { EDGES, CORNERS } = pattern.patternData;
  return (
    CORNERS.pieces[pair.corner] === pair.corner &&
    CORNERS.orientation[pair.corner] === 0 &&
    EDGES.pieces[pair.edge] === pair.edge &&
    EDGES.orientation[pair.edge] === 0
  );
};

describe("planCross", () => {
  it("every plan really does finish the cross, and claims its pairs honestly", () => {
    for (let i = 0; i < 20; i++) {
      const scramble = randomScramble();
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      const { plans } = planCross(kpuzzle, pattern, { extra: 2 });
      expect(plans.length, scramble).toBeGreaterThan(0);
      for (const plan of plans.slice(0, 12)) {
        const after = pattern.applyAlg(new Alg(plan.moves.join(" ")));
        expect(crossDone(after), `${scramble} / ${plan.moves.join(" ")}`).toBe(true);
        for (const name of plan.pairs) {
          expect(pairDone(after, name), `${scramble} claims ${name}`).toBe(true);
        }
        // And it must not under-claim: any pair it finished should be listed.
        for (const pair of PAIRS) {
          if (pairDone(after, pair.name)) expect(plan.pairs).toContain(pair.name);
        }
      }
    }
  });

  it("agrees with the exact solver about the shortest cross", () => {
    const solver = crossSolver(kpuzzle);
    for (let i = 0; i < 20; i++) {
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(randomScramble()));
      const { shortest, plans } = planCross(kpuzzle, pattern, { extra: 1 });
      expect(shortest).toBe(solver.lengthFrom(pattern));
      // Something of exactly that length must be among the plans.
      expect(Math.min(...plans.map((p) => p.moves.length))).toBe(shortest);
    }
  });

  it("puts the plans that solve most pairs first", () => {
    for (let i = 0; i < 10; i++) {
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(randomScramble()));
      const { plans } = planCross(kpuzzle, pattern, { extra: 3 });
      for (let j = 1; j < plans.length; j++) {
        const before = plans[j - 1];
        const after = plans[j];
        expect(
          before.pairs.length > after.pairs.length ||
            (before.pairs.length === after.pairs.length &&
              before.moves.length <= after.moves.length),
        ).toBe(true);
      }
    }
  });

  it("finds an XCross that is there to be found", () => {
    // Undo an F2L insertion from a solved cube: the cross and that pair are both a
    // few moves away, so a cross that also finishes the pair must exist.
    const pattern = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg("R U R' U'").invert())
      .applyAlg(new Alg("D2 L' D"));
    const { plans } = planCross(kpuzzle, pattern, { extra: 4 });
    expect(plans[0].pairs.length).toBeGreaterThanOrEqual(1);
  });

  it("stays quick enough to run while someone is holding the cube", () => {
    const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(randomScramble()));
    const started = Date.now();
    planCross(kpuzzle, pattern, { extra: 3 });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
