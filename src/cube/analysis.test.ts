import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { analyseSolve, type TimedMove } from "./analysis";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

/** Turn an alg into moves timed 200 ms apart, so phase boundaries are easy to read. */
function timed(alg: string, step = 200): TimedMove[] {
  return Array.from(new Alg(alg).expand().childAlgNodes()).map((n, i) => ({
    move: n.toString(),
    t: (i + 1) * step,
  }));
}

describe("analyseSolve", () => {
  // Built backwards from a solved cube: each F2L slot is opened with its own
  // four-move trigger, then OLL and PLL cases are layered on top. The forward
  // solution is therefore a textbook CFOP solve with known phase lengths.
  const extractions = [
    "F U F' U'", // FL slot
    "L U L' U'", // BL slot
    "B U B' U'", // BR slot
    "R U R' U'", // FR slot
  ];
  const oll = "R U R' U R U2' R'"; // Sune
  const pll = "R U R' U' R' F R2 U' R' U' R U R' F'"; // T-perm

  const solution = new Alg(
    [...extractions].reverse().map((e) => new Alg(e).invert().toString()).join(" ") +
      " " + oll + " " + pll,
  );
  const scrambled = kpuzzle
    .defaultPattern()
    .applyAlg(new Alg(pll).invert())
    .applyAlg(new Alg(oll).invert())
    .applyAlg(new Alg(extractions.join(" ")));

  it("recovers the CFOP phase structure of a constructed solve", () => {
    const moves = timed(solution.toString());
    const analysis = analyseSolve(scrambled, moves);
    expect(analysis).not.toBeNull();
    expect(analysis!.crossFace).toBe("D");

    const byName = Object.fromEntries(
      analysis!.phases.map((p) => [p.name, p]),
    );
    expect(byName["Cross"].moveCount).toBe(0);
    expect(byName["F2L #1"].moveCount).toBe(4);
    expect(byName["F2L #2"].moveCount).toBe(4);
    expect(byName["F2L #3"].moveCount).toBe(4);
    expect(byName["F2L #4"].moveCount).toBe(4);
    expect(byName["OLL"].moveCount).toBe(7);
    expect(byName["PLL"].moveCount).toBe(14);

    // The slots must be reported in the order they were finished.
    expect(
      ["F2L #1", "F2L #2", "F2L #3", "F2L #4"].map((n) => byName[n].detail),
    ).toEqual(["FR", "BR", "BL", "FL"]);

    expect(analysis!.moveCount).toBe(16 + 7 + 14);
    expect(analysis!.durationMs).toBe(analysis!.moveCount * 200);
    expect(analysis!.tps).toBeCloseTo(5, 5);
  });

  it("dates a milestone by when it sticks, not by a lucky moment", () => {
    // PLL breaks and restores F2L slots; none of that may be credited to F2L.
    const moves = timed(solution.toString());
    const analysis = analyseSolve(scrambled, moves)!;
    const f2l4 = analysis.phases.find((p) => p.name === "F2L #4")!;
    expect(f2l4.toMove).toBe(16);
  });

  it("reports pauses between moves", () => {
    const moves = timed(solution.toString(), 100);
    moves.forEach((m, i) => {
      if (i >= 4) m.t += 900; // a long think after the first pair
    });
    const analysis = analyseSolve(scrambled, moves)!;
    expect(analysis.pauses).toHaveLength(1);
    expect(analysis.pauses[0].durationMs).toBe(1000);
    expect(analysis.phases[1].durationMs).toBe(400); // F2L #1 unaffected
  });

  it("returns null for a solve that does not finish solved", () => {
    expect(analyseSolve(scrambled, timed("R U"))).toBeNull();
    expect(analyseSolve(scrambled, [])).toBeNull();
  });
});
