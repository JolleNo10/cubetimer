import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { fullSolution } from "./StepBreakdown";
import { analyseSolve } from "../cube/analysis";
import { patternToFacelets } from "../cube/facelets";
import { FACES, FACE_OFFSET } from "../cube/moves";
import { get3x3x3 } from "../cube/puzzle";
import { GENERATORS, IDENTITY, compose } from "../cube/orientation";

const kpuzzle = await get3x3x3();

/** Solved, allowing for the cube having been turned over along the way. */
function isSolvedAnyWayUp(pattern: ReturnType<typeof kpuzzle.defaultPattern>) {
  const facelets = patternToFacelets(pattern);
  return FACES.every((face) => {
    const start = FACE_OFFSET[face];
    const colour = facelets[start];
    return facelets.slice(start, start + 9) === colour.repeat(9);
  });
}

const quarterTurns = (alg: string) =>
  Array.from(new Alg(alg).expand().childAlgNodes()).flatMap((node) => {
    const move = node.toString();
    const match = /^([URFDLB])(2'?|')?$/.exec(move)!;
    return (match[2] ?? "").startsWith("2") ? [match[1], match[1]] : [move];
  });

describe("fullSolution", () => {
  it("is a solution: applying it to the scramble solves the cube", () => {
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
    const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const moves = quarterTurns(new Alg(scramble).invert().toString()).map(
      (move, i) => ({ move, t: (i + 1) * 150 }),
    );
    const analysis = analyseSolve(scrambled, moves)!;

    const solution = fullSolution(analysis);
    expect(solution.length).toBeGreaterThan(0);
    // Written in the solver's frame, so the cube ends solved but possibly turned over.
    expect(isSolvedAnyWayUp(scrambled.applyAlg(new Alg(solution)))).toBe(true);
  });

  it("holds for a solve done with the cross on another face", () => {
    // Held upside down: the analyser reorients, and the solution must still work.
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
    const upsideDown = new Alg(scramble)
      .invert()
      .toString()
      .replace(/U/g, "§")
      .replace(/D/g, "U")
      .replace(/§/g, "D")
      .replace(/R/g, "¤")
      .replace(/L/g, "R")
      .replace(/¤/g, "L");
    const setup = new Alg(upsideDown).invert();
    const scrambled = kpuzzle.defaultPattern().applyAlg(setup);
    const moves = quarterTurns(upsideDown).map((move, i) => ({
      move,
      t: (i + 1) * 150,
    }));
    const analysis = analyseSolve(scrambled, moves)!;
    expect(isSolvedAnyWayUp(scrambled.applyAlg(new Alg(fullSolution(analysis))))).toBe(
      true,
    );
  });

  it("is still a solution when the solver turned the cube partway through", () => {
    // The whole point of tracking the grip: the rotations go into the solution, and
    // every move after one is named for the face it was from the solver's new side.
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
    const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const moves = quarterTurns(new Alg(scramble).invert().toString()).map(
      (move, i) => ({ move, t: (i + 1) * 150 }),
    );
    // Held as scrambled to begin with, then turned a quarter and a half turn round.
    const orientations = moves.map((_, i) =>
      i < 4 ? IDENTITY : i < 9 ? GENERATORS.y : compose(GENERATORS.y, GENERATORS.y),
    );
    const analysis = analyseSolve(scrambled, moves, {
      orientations,
      inspection: [],
    })!;

    const solution = fullSolution(analysis);
    expect(solution).toMatch(/\by\b/);
    expect(isSolvedAnyWayUp(scrambled.applyAlg(new Alg(solution)))).toBe(true);
  });

  it("contains every step's moves, in order", () => {
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
    const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const moves = quarterTurns(new Alg(scramble).invert().toString()).map(
      (move, i) => ({ move, t: (i + 1) * 150 }),
    );
    const analysis = analyseSolve(scrambled, moves)!;
    const solution = fullSolution(analysis);
    for (const step of analysis.steps) {
      if (step.moves) expect(solution).toContain(step.moves);
    }
  });
});
