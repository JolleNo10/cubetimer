import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { analyseSolve, isTrustedCfopAnalysis } from "./analysis";
import { cfopSolution } from "./cfopSolve";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();
const SCRAMBLES = [
  "D' L' B2 R' D L B U F2 U2 F B' U2 R2 B R2 D2 L2 D2 R2 U",
  "B2 D' R F B' L' B D2 R U2 L2 F2 U' L2 B2 D F2 B2 D2 R2 D R2",
  "R U R' U' R' F R2 U' R' U' R U R' F'",
  "F2 U' B2 R2 D' L2 U F2 U2 B2 R' D' F' L U' R2 B' D2 F' U",
];

describe("cfopSolution", () => {
  for (const scramble of SCRAMBLES) {
    it(`solves ${scramble} through CFOP's phases, as the analysis reads them`, () => {
      const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      const moves = cfopSolution(kpuzzle, scrambled);
      expect(scrambled.applyAlg(new Alg(moves.join(" "))).isIdentical(kpuzzle.defaultPattern())).toBe(true);
      const analysis = analyseSolve(scrambled, moves.map((move, i) => ({ move, t: (i + 1) * 200 })), null, { observedStartBottomFace: "D" });
      expect(isTrustedCfopAnalysis(analysis), JSON.stringify(analysis?.quality)).toBe(true);
      expect(analysis!.crossFace).toBe("D");
    });
  }
});
