import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { algBetween, normalizeFaceTurns } from "./solver";
import { get3x3x3 } from "./puzzle";
import { patternToFacelets } from "./facelets";

describe("normalizeFaceTurns", () => {
  it("rewrites awkward amounts as standard notation", () => {
    expect(normalizeFaceTurns(new Alg("D3' B2' R4 U5")).toString()).toBe("D B2 U");
  });

  it("leaves ordinary algs alone", () => {
    expect(normalizeFaceTurns(new Alg("R U R' U'")).toString()).toBe("R U R' U'");
  });
});

const kpuzzle = await get3x3x3();

describe("algBetween", () => {
  const scramble = "R U2 F' L D2 B R' U F2 D";

  it("returns a sequence that really does connect the two states", async () => {
    const from = kpuzzle.defaultPattern().applyAlg(new Alg("D2 L' B"));
    const to = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const alg = await algBetween(from, to);
    expect(patternToFacelets(from.applyAlg(alg))).toBe(patternToFacelets(to));
  });

  it("undoes a single wrong turn in a single move", async () => {
    const to = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const from = to.applyMove("B");
    const alg = await algBetween(from, to);
    expect(alg.toString()).toBe("B'");
  });

  it("is empty when the cube is already there", async () => {
    const to = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    expect((await algBetween(to, to)).toString()).toBe("");
  });
});
