import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { crossSolver } from "./crossSolver";
import { EDGES_OF_FACE } from "./moves";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();
const solver = crossSolver(kpuzzle);

const crossIsDone = (pattern: ReturnType<typeof kpuzzle.defaultPattern>) => {
  const edges = pattern.patternData.EDGES;
  return EDGES_OF_FACE.D.every(
    (slot) => edges.pieces[slot] === slot && edges.orientation[slot] === 0,
  );
};

describe("CrossSolver", () => {
  it("says a finished cross needs nothing", () => {
    expect(solver.lengthFrom(kpuzzle.defaultPattern())).toBe(0);
    expect(solver.solve(kpuzzle.defaultPattern())).toEqual([]);
  });

  it("never needs more than eight moves, which is the known maximum", () => {
    // The hardest cross on a 3x3x3 takes eight quarter turns; if the table said more,
    // it would be wrong.
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const scramble = Array.from({ length: 20 }, () => {
        const faces = "URFDLB";
        const suffix = ["", "'", "2"];
        return (
          faces[Math.floor(Math.random() * 6)] +
          suffix[Math.floor(Math.random() * 3)]
        );
      }).join(" ");
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      worst = Math.max(worst, solver.lengthFrom(pattern));
    }
    expect(worst).toBeLessThanOrEqual(8);
    expect(worst).toBeGreaterThanOrEqual(6);
  });

  it("returns a solution that really does finish the cross", () => {
    for (let i = 0; i < 100; i++) {
      const scramble = Array.from({ length: 15 }, () => {
        const faces = "URFDLB";
        const suffix = ["", "'", "2"];
        return (
          faces[Math.floor(Math.random() * 6)] +
          suffix[Math.floor(Math.random() * 3)]
        );
      }).join(" ");
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      const solution = solver.solve(pattern);
      expect(solution).toHaveLength(solver.lengthFrom(pattern));
      expect(crossIsDone(pattern.applyAlg(new Alg(solution.join(" ")))), scramble).toBe(
        true,
      );
    }
  });

  it("is exact: no shorter solution exists", () => {
    // Every one of the eighteen first moves must leave at least as much work to do.
    for (let i = 0; i < 50; i++) {
      const scramble = Array.from({ length: 12 }, () => {
        const faces = "URFDLB";
        return faces[Math.floor(Math.random() * 6)] + ["", "'", "2"][i % 3];
      }).join(" ");
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      const best = solver.lengthFrom(pattern);
      for (const face of "URFDLB") {
        for (const suffix of ["", "'", "2"]) {
          const after = solver.lengthFrom(pattern.applyMove(`${face}${suffix}`));
          expect(after).toBeGreaterThanOrEqual(best - 1);
        }
      }
    }
  });
});
