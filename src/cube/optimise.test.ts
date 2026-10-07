import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { findShorter, MAX_SEARCH_DEPTH } from "./optimise";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();
const solved = kpuzzle.defaultPattern();

describe("findShorter", () => {
  it("finds a shorter way to the same state, and it gets there", async () => {
    // Three Rs, a U and its undo, and an R' come to a single R2.
    const wasteful = "R R R U U' R'";
    const to = solved.applyAlg(new Alg(wasteful));
    const result = await findShorter(kpuzzle, solved, to, 7);
    expect(result.best).not.toBeNull();
    expect(result.bestLength).toBeLessThan(7);
    expect(solved.applyAlg(new Alg(result.best!)).isIdentical(to)).toBe(true);
  });

  it("says a step is already the shortest when nothing shorter exists", async () => {
    const to = solved.applyAlg(new Alg("R U F"));
    expect(await findShorter(kpuzzle, solved, to, 3)).toMatchObject({ best: null, optimal: true, tooDeep: false });
  });

  it("calls a one-move step optimal", async () => {
    expect(await findShorter(kpuzzle, solved, solved.applyAlg(new Alg("R")), 1)).toMatchObject({ optimal: true, tooDeep: false });
  });

  it("does not search beyond its depth", async () => {
    const result = await findShorter(kpuzzle, solved, solved, MAX_SEARCH_DEPTH + 2);
    expect(result).toMatchObject({ tooDeep: true, optimal: false, best: null });
  });
});
