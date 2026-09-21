import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { analyseAlternatives } from "./analytics";
import { analyseSolve } from "../cube/analysis";
import { get3x3x3 } from "../cube/puzzle";
import type { Solve } from "./types";

const kpuzzle = await get3x3x3();

/** A solve that wastes moves: each pair is inserted, taken out and put back. */
function buildSolve(solution: string, scramble: string): Solve {
  const moves = Array.from(new Alg(solution).expand().childAlgNodes())
    .flatMap((node) => {
      const move = node.toString();
      const match = /^([URFDLB])(2'?|')?$/.exec(move)!;
      return (match[2] ?? "").startsWith("2") ? [match[1], match[1]] : [move];
    })
    .map((move, i) => ({ move, t: (i + 1) * 200 }));
  const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
  return {
    id: "x", sessionId: "s", createdAt: 0, rawMs: moves.at(-1)!.t, penalty: "none",
    scramble, event: "333", source: "smartcube", moves,
    analysis: analyseSolve(scrambled, moves),
  } as Solve;
}

describe("analyseAlternatives", () => {
  const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const solve = buildSolve(new Alg(scramble).invert().toString(), scramble);
  const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));

  it("finds the best cross available from the scramble", async () => {
    const result = await analyseAlternatives(kpuzzle, solve, scrambled);
    expect(result.cross).not.toBeNull();
    expect(result.cross!.length).toBeLessThanOrEqual(8);
    // The sequence it gives really does finish the cross.
    const after = scrambled.applyAlg(new Alg(result.cross!.alg));
    const edges = after.patternData.EDGES;
    for (const slot of [4, 5, 6, 7]) {
      expect(edges.pieces[slot]).toBe(slot);
      expect(edges.orientation[slot]).toBe(0);
    }
  }, 30_000);

  it("reports a step's shortest equivalent, and says when it looked and found none",
    async () => {
      const result = await analyseAlternatives(kpuzzle, solve, scrambled);
      expect(result.steps).toHaveLength(7);
      for (const step of result.steps) {
        // Whatever it says, it must be self-consistent.
        if (step.best) expect(step.bestLength).toBeLessThan(step.used);
        else expect(step.optimal || step.tooDeep || step.used === 0).toBe(true);
      }
    }, 30_000);

  it("counts a written algorithm the way a cuber would", async () => {
    const result = await analyseAlternatives(kpuzzle, solve, scrambled);
    const pll = result.steps.find((s) => s.name === "PLL");
    // The T-perm case: fourteen moves, and its rotation-free algorithm is fourteen.
    expect(pll?.reference?.length).toBe(14);
  }, 30_000);
});

describe("which way up the sequences are written", () => {
  // A solve done with the cube upside down: the frame matters here, and a sequence
  // written in the wrong one would quietly turn the wrong faces.
  const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const flipped = new Alg(scramble)
    .invert()
    .toString()
    .replace(/U/g, "§").replace(/D/g, "U").replace(/§/g, "D")
    .replace(/R/g, "¤").replace(/L/g, "R").replace(/¤/g, "L");
  const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(flipped).invert());
  const solve = buildSolve(flipped, new Alg(flipped).invert().toString());

  it("says which faces are down and in front", async () => {
    const result = await analyseAlternatives(kpuzzle, solve, scrambled);
    // The cross face is the one underneath, by definition.
    expect(result.grip.bottom).toBe(solve.analysis!.crossFace);
    expect(result.grip.front).not.toBe(result.grip.bottom);
  }, 30_000);

  it("writes the cross in that frame, not the cube's", async () => {
    const { rotationForCrossFace } = await import("../cube/orientation");
    const { reframe } = await import("../cube/recognise");
    const result = await analyseAlternatives(kpuzzle, solve, scrambled);
    const facing = reframe(
      kpuzzle,
      scrambled,
      new Alg(rotationForCrossFace(solve.analysis!.crossFace).tokens.join(" ")),
    );
    // Read as the solver holds it, the sequence finishes the cross underneath.
    const after = facing.applyAlg(new Alg(result.cross!.alg));
    for (const slot of [4, 5, 6, 7]) {
      expect(after.patternData.EDGES.pieces[slot]).toBe(slot);
      expect(after.patternData.EDGES.orientation[slot]).toBe(0);
    }
  }, 30_000);
});
