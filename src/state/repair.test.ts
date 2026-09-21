import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { get3x3x3 } from "../cube/puzzle";
import { patternToFacelets } from "../cube/facelets";
import { rebuildAnalysis } from "./repair";
import type { Solve } from "./types";

const kpuzzle = await get3x3x3();

const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
const moves = Array.from(new Alg(scramble).invert().expand().childAlgNodes())
  .flatMap((node) => {
    const move = node.toString();
    const match = /^([URFDLB])(2'?|')?$/.exec(move)!;
    return (match[2] ?? "").startsWith("2")
      ? [match[1], match[1]]
      : [match[1] + (match[2] ?? "")];
  })
  .map((move, i) => ({ move, t: (i + 1) * 150 }));

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: "1",
    sessionId: "s",
    createdAt: 0,
    rawMs: moves.at(-1)!.t,
    penalty: "none",
    scramble,
    event: "333",
    source: "smartcube",
    moves,
    ...overrides,
  } as Solve;
}

describe("rebuildAnalysis", () => {
  it("rebuilds a breakdown from the scramble and the moves", () => {
    const rebuilt = rebuildAnalysis(kpuzzle, solve());
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.analysis!.steps).toHaveLength(7);
    expect(rebuilt!.analysis!.steps.at(-1)!.case).toBe("T");
  });

  it("prefers the recorded starting state over the scramble text", () => {
    const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const rebuilt = rebuildAnalysis(
      kpuzzle,
      solve({
        scramble: "nonsense that will not parse",
        scrambledFacelets: patternToFacelets(scrambled),
      }),
    );
    expect(rebuilt!.analysis!.steps).toHaveLength(7);
  });

  it("leaves alone a solve that already has one", () => {
    const already = rebuildAnalysis(kpuzzle, solve())!;
    expect(rebuildAnalysis(kpuzzle, already)).toBeNull();
  });

  it("leaves alone a solve with no moves to work from", () => {
    expect(rebuildAnalysis(kpuzzle, solve({ moves: [], source: "keyboard" }))).toBeNull();
  });

  it("gives up quietly when the solve does not end solved", () => {
    expect(
      rebuildAnalysis(kpuzzle, solve({ moves: [{ move: "R", t: 10 }] })),
    ).toBeNull();
  });

  it("gives up quietly when there is no scramble at all", () => {
    expect(
      rebuildAnalysis(kpuzzle, solve({ scramble: "", scrambledFacelets: undefined })),
    ).toBeNull();
  });
});
