import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { F2L_CASES, F2L_POSITIONS } from "./f2lCases";

describe("F2L reference catalogue", () => {
  it("contains ordered, parseable references for every case and position", () => {
    expect(F2L_CASES).toHaveLength(41);
    expect(new Set(F2L_CASES.map(({ name }) => name)).size).toBe(41);

    for (const f2lCase of F2L_CASES) {
      for (const position of F2L_POSITIONS) {
        expect(Object.keys(f2lCase.algorithms)).toEqual([...F2L_POSITIONS]);
        const algorithms = f2lCase.algorithms[position];
        expect(algorithms.length, `${f2lCase.name} ${position}`).toBeGreaterThan(0);
        expect(new Set(algorithms).size, `${f2lCase.name} ${position}`).toBe(
          algorithms.length,
        );
        for (const algorithm of algorithms) {
          expect(algorithm.trim(), `${f2lCase.name} ${position}`).not.toBe("");
          expect(() => new Alg(algorithm), `${f2lCase.name} ${position}`).not.toThrow();
        }
      }
    }
  });
});
