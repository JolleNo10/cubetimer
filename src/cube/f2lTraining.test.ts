import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { faceColour } from "./colours";
import { faceletsToPattern, patternToFacelets } from "./facelets";
import { F2L_CASES } from "./f2lCases";
import {
  buildExactF2lTarget,
  buildStandardF2lTarget,
  calculateTrainingEfficiency,
  f2lCubeAlgorithm,
  f2lCubeMoves,
  f2lHandAlgorithm,
  f2lHandMoves,
  f2lHandTimedMoves,
  isF2lSetupTrackable,
  isStandardF2lBase,
  isF2lTrainingComplete,
  reconstructF2lStepStart,
  standardF2lTrainingRotation,
} from "./f2lTraining";
import { get3x3x3 } from "./puzzle";
import { algBetween } from "./solver";
import { reorientMove, slotInCubeFrame } from "./orientation";
import { reframe } from "./recognise";
import { ScrambleTracker } from "./scramble";
import { parseFaceMove } from "./moves";
import type { Solve } from "../state/types";

const kpuzzle = await get3x3x3();

function flipFacelets(facelets: string, a: number, b: number): string {
  const next = [...facelets];
  [next[a], next[b]] = [next[b], next[a]];
  return next.join("");
}

describe("F2L training targets", () => {
  function solveReference(target: ReturnType<typeof buildStandardF2lTarget>, algorithm: string) {
    const rotation = standardF2lTrainingRotation();
    const rotationAlg = new Alg(rotation.tokens.join(" "));
    return reframe(
      kpuzzle,
      reframe(kpuzzle, target.pattern, rotationAlg)
        .applyAlg(new Alg(algorithm)),
      rotationAlg.invert(),
    );
  }

  it("recognizes an F2L-complete white-cross base while ignoring the last layer", () => {
    expect(isStandardF2lBase(kpuzzle.defaultPattern())).toBe(true);
    expect(isStandardF2lBase(kpuzzle.defaultPattern().applyAlg(new Alg("D2")))).toBe(true);
    expect(isStandardF2lBase(kpuzzle.defaultPattern().applyAlg(new Alg("U")))).toBe(false);
    expect(isStandardF2lBase(kpuzzle.defaultPattern().applyAlg(new Alg("R")))).toBe(false);
  });

  it("builds every standard case with a valid reference solution", () => {
    const rotation = standardF2lTrainingRotation();
    const rotationAlg = new Alg(rotation.tokens.join(" "));
    expect(rotation.orientation.U).toBe("D");
    expect(rotation.orientation.D).toBe("U");
    expect(rotation.orientation.R).toBe("L");
    expect(rotation.orientation.L).toBe("R");
    expect(rotation.orientation.F).toBe("F");
    expect(rotation.orientation.B).toBe("B");

    for (const f2lCase of F2L_CASES) {
      const target = buildStandardF2lTarget(kpuzzle, f2lCase);
      expect(target.info.crossFace).toBe("U");
      expect(faceColour(target.info.crossFace).name).toBe("white");
      expect(target.info.slot).toBe(slotInCubeFrame(rotation.orientation, "FR"));
      expect(isF2lTrainingComplete(target, target.pattern), f2lCase.name).toBe(false);
      const handFrame = reframe(kpuzzle, target.pattern, rotationAlg);
      const solved = reframe(
        kpuzzle,
        handFrame.applyAlg(new Alg(f2lCase.alg)),
        rotationAlg.invert(),
      );
      expect(
        isF2lTrainingComplete(target, solved),
        f2lCase.name,
      ).toBe(true);
      expect(target.info.reference?.alg).toBe(f2lCase.alg);
    }
  });

  it("builds the same case relative to different last-layer contexts", () => {
    const f2lCase = F2L_CASES[3];
    const baseA = kpuzzle.defaultPattern();
    const baseB = baseA.applyAlg(new Alg("D2"));
    const targetA = buildStandardF2lTarget(kpuzzle, f2lCase, baseA);
    const targetB = buildStandardF2lTarget(kpuzzle, f2lCase, baseB);

    expect(targetA.info.slot).toBe(targetB.info.slot);
    expect(targetA.info.protectedSlots).toEqual(targetB.info.protectedSlots);
    expect(patternToFacelets(targetA.pattern)).not.toBe(patternToFacelets(targetB.pattern));
    expect(isF2lTrainingComplete(targetA, solveReference(targetA, f2lCase.alg))).toBe(true);
    expect(isF2lTrainingComplete(targetB, solveReference(targetB, f2lCase.alg))).toBe(true);
  });

  it("keeps an outer-turn catalogue setup and maps it to raw tracker moves", () => {
    const f2lCase = F2L_CASES[3];
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    const target = buildStandardF2lTarget(kpuzzle, f2lCase, base);
    const grip = standardF2lTrainingRotation().orientation;
    const rawSetup = f2lCubeAlgorithm(f2lCase.setup, grip);
    const tracker = new ScrambleTracker(kpuzzle, rawSetup, base);

    expect(isF2lSetupTrackable(f2lCase.setup)).toBe(true);
    expect(f2lCase.setup).toBe("R U' R'");
    expect(rawSetup).toBe("L D' L'");
    expect(patternToFacelets(tracker.targetPattern)).toBe(patternToFacelets(target.pattern));
  });

  it("falls back to an outer-face route for wide or slice catalogue setups", async () => {
    const f2lCase = F2L_CASES[7];
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    const target = buildStandardF2lTarget(kpuzzle, f2lCase, base);
    const setup = await algBetween(base, target.pattern);
    const tracker = new ScrambleTracker(kpuzzle, setup.toString(), base);

    expect(isF2lSetupTrackable(f2lCase.setup)).toBe(false);
    expect(tracker.moves.every((move) => parseFaceMove(move) !== null)).toBe(true);
    expect(patternToFacelets(tracker.targetPattern)).toBe(patternToFacelets(target.pattern));
  });

  it("translates raw cube moves into the explicit white-bottom green-front grip", () => {
    const grip = standardF2lTrainingRotation().orientation;
    expect(f2lHandMoves(["L", "L'", "L2", "R", "D", "D'", "D2", "U", "F", "B"], grip))
      .toEqual(["R", "R'", "R2", "L", "U", "U'", "U2", "D", "F", "B"]);
    expect(f2lHandAlgorithm("D' L", grip)).toBe("U' R");
    expect(f2lCubeMoves(["R", "U'", "R'"], grip)).toEqual(["L", "D'", "L'"]);
    expect(reorientMove("L", grip)).toBe("R");
  });

  it("keeps setup tracking raw while presenting the setup in hand notation", () => {
    const raw = new ScrambleTracker(kpuzzle, "L D L'");
    const grip = standardF2lTrainingRotation().orientation;
    expect(raw.moves).toEqual(["L", "D", "L'"]);
    expect(f2lHandMoves(raw.moves, grip)).toEqual(["R", "U", "R'"]);
    expect(patternToFacelets(raw.targetPattern)).toBe(
      patternToFacelets(kpuzzle.defaultPattern().applyAlg(new Alg("L D L'"))),
    );
  });

  it("reconstructs an exact F2L step start from raw cube moves", () => {
    const scramble = "R U F2 L'";
    const solve = {
      id: "solve-1",
      scramble,
      scrambledFacelets: patternToFacelets(kpuzzle.defaultPattern().applyAlg(new Alg(scramble))),
      moves: [
        { move: "D", t: 10 },
        { move: "R'", t: 20 },
        { move: "U2", t: 30 },
      ],
    } as unknown as Solve;

    const start = reconstructF2lStepStart(kpuzzle, solve, 2);
    const expected = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg(scramble))
      .applyAlg(new Alg("D R'"));
    expect(patternToFacelets(start)).toBe(patternToFacelets(expected));
  });

  it("preserves exact-step metadata and does not invent a buried reference", () => {
    const solve = {
      id: "solve-2",
      scramble: "R U",
      moves: [],
      analysis: { crossFace: "D" },
    } as unknown as Solve;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const target = buildExactF2lTarget(kpuzzle, solve, step);
    expect(target.info.origin).toMatchObject({ kind: "solve-step", solveId: "solve-2", slot: "FR" });
    expect(target.info.crossFace).toBe("D");
  });

  it("reuses the standard reference when an exact setup is recognizable and valid", () => {
    const f2lCase = F2L_CASES[0];
    const solve = {
      id: "solve-3",
      scramble: f2lCase.setup,
      moves: [{ move: "U", t: 10 }],
      analysis: { crossFace: "D" },
    } as unknown as Solve;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const target = buildExactF2lTarget(kpuzzle, solve, step);
    expect(target.info.reference?.caseName).toBe(f2lCase.name);
    expect(target.info.reference?.alg).toBe("U R U' R'");
  });

  it("requires the cross and previously solved slots to stay solved", () => {
    const target = buildStandardF2lTarget(kpuzzle, F2L_CASES[0]);
    const rotation = standardF2lTrainingRotation();
    const rotationAlg = new Alg(rotation.tokens.join(" "));
    const solved = reframe(
      kpuzzle,
      reframe(kpuzzle, target.pattern, rotationAlg).applyAlg(new Alg(F2L_CASES[0].alg)),
      rotationAlg.invert(),
    );
    expect(isF2lTrainingComplete(target, solved)).toBe(true);

    const crossBroken = faceletsToPattern(kpuzzle, flipFacelets(patternToFacelets(solved), 7, 19));
    expect(isF2lTrainingComplete(target, crossBroken)).toBe(false);

    const protectedSlotBroken = faceletsToPattern(kpuzzle, flipFacelets(patternToFacelets(solved), 21, 41));
    expect(isF2lTrainingComplete(target, protectedSlotBroken)).toBe(false);

    const handLastLayer = reframe(
      kpuzzle,
      reframe(kpuzzle, solved, rotationAlg).applyAlg(new Alg("U2")),
      rotationAlg.invert(),
    );
    expect(isF2lTrainingComplete(target, handLastLayer)).toBe(true);
  });

  it("allows an unsolved future pair to remain unsolved", async () => {
    const targetCase = F2L_CASES[0];
    const futureCase = F2L_CASES[1];
    const futureAtFl = reframe(
      kpuzzle,
      kpuzzle.defaultPattern().applyAlg(new Alg(futureCase.setup)),
      new Alg("y"),
    );
    const futureSetup = await algBetween(kpuzzle.defaultPattern(), futureAtFl);
    const start = kpuzzle
      .defaultPattern()
      .applyAlg(futureSetup)
      .applyAlg(new Alg(targetCase.setup));
    const solve = {
      id: "solve-future-pair",
      scramble: "",
      scrambledFacelets: patternToFacelets(start),
      moves: [{ move: "U", t: 10 }],
      analysis: { crossFace: "D" },
    } as unknown as Solve;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const target = buildExactF2lTarget(kpuzzle, solve, step);
    const done = target.pattern.applyAlg(new Alg(targetCase.alg));

    expect(target.info.protectedSlots).not.toContain("FL");
    expect(isF2lTrainingComplete(target, done)).toBe(true);
  });

  it("uses merged smart-cube turns for STM and reference deltas", () => {
    const grip = standardF2lTrainingRotation().orientation;
    const result = calculateTrainingEfficiency(
      f2lHandTimedMoves([
        { move: "L", t: 10 },
        { move: "D", t: 100 },
        { move: "L'", t: 900 },
      ], grip),
      { alg: "R U R'", stm: 3 },
    );
    expect(result.moves.map(({ move }) => move)).toEqual(["R", "U", "R'"]);
    expect(result.stm).toBe(3);
    expect(result.delta).toBe(0);

    const merged = calculateTrainingEfficiency(
      [
        { move: "U", t: 10 },
        { move: "U", t: 100 },
        { move: "R", t: 900 },
      ],
      { alg: "U2 R", stm: 2 },
    );
    expect(merged.moves.map(({ move }) => move)).toEqual(["U2", "R"]);
    expect(merged.stm).toBe(2);
    expect(merged.delta).toBe(0);
  });
});
