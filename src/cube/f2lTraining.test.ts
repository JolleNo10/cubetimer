import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { faceColour } from "./colours";
import { faceletsToPattern, patternToFacelets } from "./facelets";
import { F2L_POSITIONS, f2lPositionTransform } from "./f2lCases";
import { F2L_TRAINING_CATALOGUES } from "./f2lTrainingCases";
import {
  buildExactF2lTarget,
  buildF2lCatalogueTarget,
  calculateTrainingEfficiency,
  f2lCatalogueSetupMoves,
  f2lPositionSetup,
  f2lCubeAlgorithm,
  f2lCubeMoves,
  f2lHandAlgorithm,
  f2lHandMoves,
  f2lHandTimedMoves,
  isF2lSetupTrackable,
  isStandardF2lBase,
  isF2lTrainingComplete,
  reconstructF2lStepStart,
  referenceExecutionSignature,
  standardF2lTrainingRotation,
  type F2lTrainingSolveInput,
} from "./f2lTraining";
import { get3x3x3 } from "./puzzle";
import { algBetween } from "./solver";
import {
  reorientMove,
  rotationForCrossFace,
  rotationForGrip,
  slotInCubeFrame,
} from "./orientation";
import { encodeGripTrack } from "./gripTrack";
import { reframe, withCentresHome } from "./recognise";
import { ScrambleTracker } from "./scramble";
import { parseFaceMove } from "./moves";

const kpuzzle = await get3x3x3();
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;

function flipFacelets(facelets: string, a: number, b: number): string {
  const next = [...facelets];
  [next[a], next[b]] = [next[b], next[a]];
  return next.join("");
}

describe("F2L training targets", () => {
  function solveReference(target: ReturnType<typeof buildF2lCatalogueTarget>, algorithm: string) {
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

    for (const f2lCase of BASIC_CASES) {
      const target = buildF2lCatalogueTarget(kpuzzle, f2lCase);
      expect(target.info.crossFace).toBe("U");
      expect(faceColour(target.info.crossFace).name).toBe("white");
      expect(target.info.slot).toBe(slotInCubeFrame(rotation.orientation, "FR"));
      expect(isF2lTrainingComplete(target, target.pattern), f2lCase.name).toBe(false);
      const handFrame = reframe(kpuzzle, target.pattern, rotationAlg);
      const solved = reframe(
        kpuzzle,
        handFrame.applyAlg(new Alg(f2lCase.algorithms.FR[0])),
        rotationAlg.invert(),
      );
      expect(
        isF2lTrainingComplete(target, solved),
        f2lCase.name,
      ).toBe(true);
      expect(target.info.references[0]?.alg).toBe(f2lCase.algorithms.FR[0]);
    }
  });

  it("builds every case in all four positions from that position's references", () => {
    const rotation = standardF2lTrainingRotation();
    const rotationAlg = new Alg(rotation.tokens.join(" "));
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    for (const f2lCase of BASIC_CASES) {
      for (const position of F2L_POSITIONS) {
        const target = buildF2lCatalogueTarget(kpuzzle, f2lCase, position, base);
        expect(target.info.position, f2lCase.name).toBe(position);
        expect(target.info.slot, f2lCase.name).toBe(
          slotInCubeFrame(rotation.orientation, position),
        );
        expect(target.info.references.length, `${f2lCase.name} ${position}`).toBeGreaterThan(0);
        expect(target.info.references[0].alg, `${f2lCase.name} ${position}`).toBe(
          f2lCase.algorithms[position][0],
        );
        for (const reference of target.info.references) {
          const solved = reframe(
            kpuzzle,
            reframe(kpuzzle, target.pattern, rotationAlg)
              .applyAlg(new Alg(reference.alg)),
            rotationAlg.invert(),
          );
          expect(
            isF2lTrainingComplete(target, solved),
            `${f2lCase.name} ${position} #${reference.rank}`,
          ).toBe(true);
        }
      }
    }
  });

  it("re-expresses trackable catalogue setup in every positional slot", () => {
    const f2lCase = BASIC_CASES[3];
    const rotation = standardF2lTrainingRotation();
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    for (const position of F2L_POSITIONS) {
      const handSetup = f2lPositionSetup(f2lCase.setup, position);
      const target = buildF2lCatalogueTarget(kpuzzle, f2lCase, position, base);
      expect(handSetup, position).toBeTruthy();
      const raw = f2lCubeMoves(handSetup!.split(" "), rotation.orientation).join(" ");
      const tracker = new ScrambleTracker(kpuzzle, raw, base);
      expect(patternToFacelets(tracker.targetPattern), position).toBe(
        patternToFacelets(target.pattern),
      );
    }
  });

  it("builds the same case relative to different last-layer contexts", () => {
    const f2lCase = BASIC_CASES[3];
    const baseA = kpuzzle.defaultPattern();
    const baseB = baseA.applyAlg(new Alg("D2"));
    const targetA = buildF2lCatalogueTarget(kpuzzle, f2lCase, baseA);
    const targetB = buildF2lCatalogueTarget(kpuzzle, f2lCase, baseB);

    expect(targetA.info.slot).toBe(targetB.info.slot);
    expect(targetA.info.protectedSlots).toEqual(targetB.info.protectedSlots);
    expect(patternToFacelets(targetA.pattern)).not.toBe(patternToFacelets(targetB.pattern));
    expect(isF2lTrainingComplete(targetA, solveReference(targetA, f2lCase.algorithms.FR[0]))).toBe(true);
    expect(isF2lTrainingComplete(targetB, solveReference(targetB, f2lCase.algorithms.FR[0]))).toBe(true);
  });

  it("keeps an outer-turn catalogue setup and maps it to raw tracker moves", () => {
    const f2lCase = BASIC_CASES[3];
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    const target = buildF2lCatalogueTarget(kpuzzle, f2lCase, base);
    const grip = standardF2lTrainingRotation().orientation;
    const rawSetup = f2lCubeAlgorithm(f2lCase.setup, grip);
    const tracker = new ScrambleTracker(kpuzzle, rawSetup, base);

    expect(isF2lSetupTrackable(f2lCase.setup)).toBe(true);
    expect(f2lCase.setup).toBe("R U' R'");
    expect(rawSetup).toBe("L D' L'");
    expect(patternToFacelets(tracker.targetPattern)).toBe(patternToFacelets(target.pattern));
  });

  it("falls back to an outer-face route for wide or slice catalogue setups", async () => {
    const f2lCase = BASIC_CASES[7];
    const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
    const target = buildF2lCatalogueTarget(kpuzzle, f2lCase, base);
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

  it("keeps a stored whole-cube rotation in display while classifying its fixed-frame turns", () => {
    expect(referenceExecutionSignature("y R U")).toEqual(["B", "U"]);
    expect(referenceExecutionSignature("r U R'")).toEqual(["L", "F", "R'"]);

    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[12]);
    const reference = target.info.references[0];
    expect(reference.alg).toMatch(/^y'/);
    const signature = referenceExecutionSignature(reference.alg);
    expect(signature).not.toBeNull();
    const result = calculateTrainingEfficiency(
      signature!.map((move, index) => ({ move, t: index * 10 })),
      target.info.references,
    );
    expect(result.matchedReferenceRank).toBe(1);
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
    } as F2lTrainingSolveInput;

    const start = reconstructF2lStepStart(kpuzzle, solve, 2);
    const expected = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg(scramble))
      .applyAlg(new Alg("D R'"));
    expect(patternToFacelets(start)).toBe(patternToFacelets(expected));
  });

  it("keeps the complete reconstructed state as the exact training target", () => {
    const solve = {
      id: "solve-exact-state",
      scramble: "R U F2",
      scrambledFacelets: patternToFacelets(
        kpuzzle.defaultPattern().applyAlg(new Alg("R U F2")),
      ),
      moves: [
        { move: "L", t: 10 },
        { move: "D2", t: 20 },
        { move: "B'", t: 30 },
      ],
      analysis: { crossFace: "D" },
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 2,
      toMove: 3,
    } as never;

    const target = buildExactF2lTarget(kpuzzle, solve, step);
    const expected = reconstructF2lStepStart(kpuzzle, solve, 2);
    expect(patternToFacelets(target.pattern)).toBe(patternToFacelets(expected));
  });

  it("uses the recorded grip at the exact F2L step boundary", () => {
    const firstGrip = rotationForGrip("D", "F")!;
    const boundaryGrip = rotationForGrip("D", "R")!;
    const gripTrack = encodeGripTrack({
      orientations: [firstGrip.orientation, boundaryGrip.orientation],
      inspection: [],
      confidence: 1,
      warnings: [],
    });
    const solve = {
      id: "solve-grip",
      scramble: "R U",
      moves: [
        { move: "L", t: 10 },
        { move: "D", t: 20 },
      ],
      gripTrack,
      analysis: { crossFace: "D" },
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 2,
      toMove: 2 + 1,
    } as never;

    const target = buildExactF2lTarget(kpuzzle, solve, step);
    expect(target.info.trainingRotation.orientation).toEqual(boundaryGrip.orientation);
  });

  it("uses the first recorded grip at solve start and falls back when it is unavailable", () => {
    const firstGrip = rotationForGrip("D", "R")!;
    const solve = {
      id: "solve-grip-start",
      scramble: "R U",
      moves: [{ move: "L", t: 10 }],
      gripTrack: encodeGripTrack({
        orientations: [firstGrip.orientation],
        inspection: [],
        confidence: 1,
        warnings: [],
      }),
      analysis: { crossFace: "D" },
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const withGrip = buildExactF2lTarget(kpuzzle, solve, step);
    expect(withGrip.info.trainingRotation.orientation).toEqual(firstGrip.orientation);

    const withoutGrip = buildExactF2lTarget(
      kpuzzle,
      { ...solve, gripTrack: "invalid" } as F2lTrainingSolveInput,
      step,
    );
    expect(withoutGrip.info.trainingRotation.orientation).toEqual(
      rotationForCrossFace("D").orientation,
    );
  });

  it("keeps standard reference planning in a recorded non-canonical front frame", () => {
    const f2lCase = BASIC_CASES[0];
    const grip = rotationForGrip("D", "R")!;
    const gripAlg = new Alg(grip.tokens.join(" "));
    const canonical = kpuzzle.defaultPattern().applyAlg(new Alg(f2lCase.setup));
    const exactStart = reframe(kpuzzle, canonical, gripAlg.invert());
    const solve = {
      id: "solve-rotated-reference",
      scramble: "",
      scrambledFacelets: patternToFacelets(exactStart),
      moves: [{ move: "U", t: 10 }],
      gripTrack: encodeGripTrack({
        orientations: [grip.orientation],
        inspection: [],
        confidence: 1,
        warnings: [],
      }),
      analysis: { crossFace: "D" },
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 1",
      slot: slotInCubeFrame(grip.orientation, "FR"),
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;

    const target = buildExactF2lTarget(kpuzzle, solve, step);
    expect(target.info.references[0]?.caseName).toBe(f2lCase.name);
    expect(target.info.trainingRotation.orientation).toEqual(grip.orientation);
  });

  it("preserves exact-step metadata and does not invent a buried reference", () => {
    const solve = {
      id: "solve-2",
      scramble: "R U",
      moves: [],
      analysis: { crossFace: "D" },
    } as F2lTrainingSolveInput;
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
    const f2lCase = BASIC_CASES[0];
    const solve = {
      id: "solve-3",
      scramble: f2lCase.setup,
      moves: [{ move: "U", t: 10 }],
      analysis: { crossFace: "D" },
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const target = buildExactF2lTarget(kpuzzle, solve, step);
    expect(target.info.references[0]?.caseName).toBe(f2lCase.name);
    expect(target.info.references[0]?.alg).toBe("U R U' R'");
  });

  it("aligns an exact F2L 10 back-left reference by AUF without rotating to FR", () => {
    const f2lCase = BASIC_CASES.find((candidate) => candidate.name === "F2L 10")!;
    const position = "BL" as const;
    const standard = buildF2lCatalogueTarget(kpuzzle, f2lCase, position);
    const rotation = standardF2lTrainingRotation();
    const rotationAlg = new Alg(rotation.tokens.join(" "));
    const exactStart = reframe(
      kpuzzle,
      reframe(kpuzzle, standard.pattern, rotationAlg).applyAlg(new Alg("U2")),
      rotationAlg.invert(),
    );
    const solve = {
      id: "solve-auf-bl",
      scramble: "",
      scrambledFacelets: patternToFacelets(exactStart),
      moves: [{ move: "R", t: 10 }],
      gripTrack: encodeGripTrack({
        orientations: [rotation.orientation],
        inspection: [],
        confidence: 1,
        warnings: [],
      }),
      analysis: { crossFace: "U" },
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 3",
      slot: standard.info.slot,
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;

    const target = buildExactF2lTarget(kpuzzle, solve, step);
    expect(target.info.position).toBe(position);
    expect(target.info.references[0]?.alg).toBe("U L U L' U L U L'");
    expect(target.info.references[0]?.alg).not.toMatch(/^y/);
    expect(
      isF2lTrainingComplete(
        target,
        reframe(
          kpuzzle,
          reframe(kpuzzle, target.pattern, rotationAlg).applyAlg(
            new Alg(target.info.references[0]!.alg),
          ),
          rotationAlg.invert(),
        ),
      ),
    ).toBe(true);
  });

  it("requires the cross and previously solved slots to stay solved", () => {
    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    const rotation = standardF2lTrainingRotation();
    const rotationAlg = new Alg(rotation.tokens.join(" "));
    const solved = reframe(
      kpuzzle,
      reframe(kpuzzle, target.pattern, rotationAlg).applyAlg(new Alg(BASIC_CASES[0].algorithms.FR[0])),
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
    const targetCase = BASIC_CASES[0];
    const futureCase = BASIC_CASES[1];
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
    } as F2lTrainingSolveInput;
    const step = {
      name: "F2L Slot 1",
      slot: "FR",
      skipped: false,
      fromMove: 0,
      toMove: 1,
    } as never;
    const target = buildExactF2lTarget(kpuzzle, solve, step);
    const done = target.pattern.applyAlg(new Alg(targetCase.algorithms.FR[0]));

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

  it("classifies exact normalized executions against the ordered references", () => {
    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[0]);
    const references = target.info.references;
    expect(references.length).toBeGreaterThan(1);
    const timed = (algorithm: string) =>
      Array.from(new Alg(algorithm).expand().childAlgNodes()).map((node, index) => ({
        move: node.toString(),
        t: index * 10,
      }));

    const recommended = calculateTrainingEfficiency(timed(references[0].alg), references);
    expect(recommended.matchedReferenceRank).toBe(1);
    expect(recommended.delta).toBe(0);

    const alternative = calculateTrainingEfficiency(timed(references[1].alg), references);
    expect(alternative.matchedReferenceRank).toBe(2);
    expect(alternative.recommendedStm).toBe(references[0].stm);
    expect(alternative.delta).toBe(references[1].stm - references[0].stm);
  });

  it("matches wide or slice references while leaving unrelated executions custom", () => {
    const target = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[7]);
    const reference = target.info.references.find(
      (candidate) => /[MESurfdlb]/.test(candidate.alg),
    );
    expect(reference).toBeTruthy();
    expect(reference!.stm).toBeGreaterThan(0);
    const execution = referenceExecutionSignature(reference!.alg)!;
    expect(calculateTrainingEfficiency(execution.map((move, t) => ({ move, t })), [reference!])).toMatchObject({
      matchedReferenceRank: reference!.rank, stm: reference!.stm, delta: 0,
    });
    const result = calculateTrainingEfficiency(
      [{ move: "R", t: 10 }],
      [reference!],
    );
    expect(result.matchedReferenceRank).toBeNull();
  });

  it("positions the entire published Advanced case around its intended target in the existing grip", () => {
    const entry = F2L_TRAINING_CATALOGUES.advanced.cases.find((candidate) => candidate.name === "AF2L 3")!;
    const rotation = new Alg(standardF2lTrainingRotation().tokens.join(" "));
    for (const position of F2L_POSITIONS) {
      const base = kpuzzle.defaultPattern().applyAlg(new Alg("D2"));
      const target = buildF2lCatalogueTarget(kpuzzle, entry, position, base);
      const published = kpuzzle.defaultPattern().applyAlg(new Alg(entry.setup));
      const positioned = reframe(kpuzzle, published, f2lPositionTransform(entry.canonicalTarget, position).invert());
      const expected = reframe(kpuzzle,
        reframe(kpuzzle, base, rotation).applyTransformation(positioned.experimentalToTransformation()!), rotation.invert());
      expect(patternToFacelets(target.pattern)).toBe(patternToFacelets(expected));
      expect(target.info.references).toHaveLength(entry.algorithms[position].length);
      for (const reference of target.info.references) {
        expect(isF2lTrainingComplete(target, solveReference(target, reference.alg))).toBe(true);
      }
    }
    expect(entry.canonicalTarget).toBe("FL");
  });

  it("does not protect slots that began trapped, but still requires cross and initially solved slots", () => {
    const entry = F2L_TRAINING_CATALOGUES.advanced.cases.find((candidate) => candidate.name === "AF2L 1")!;
    const target = buildF2lCatalogueTarget(kpuzzle, entry, "FR");
    const done = withCentresHome(kpuzzle, solveReference(target, target.info.references[0].alg));
    expect(isF2lTrainingComplete(target, done)).toBe(true);
    const unprotected = F2L_POSITIONS.find((position) => {
      const slot = slotInCubeFrame(target.info.trainingRotation.orientation, position);
      return slot !== target.info.slot && !target.info.protectedSlots.includes(slot);
    });
    expect(unprotected).toBeDefined();
    const stillTrapped = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[3], unprotected!, done);
    expect(isF2lTrainingComplete(stillTrapped, stillTrapped.pattern)).toBe(false);
    expect(isF2lTrainingComplete(target, stillTrapped.pattern)).toBe(true);
    expect(isStandardF2lBase(stillTrapped.pattern)).toBe(false);
    const protectedPosition = F2L_POSITIONS.find((position) =>
      target.info.protectedSlots.includes(slotInCubeFrame(target.info.trainingRotation.orientation, position)))!;
    const brokenProtected = buildF2lCatalogueTarget(kpuzzle, BASIC_CASES[3], protectedPosition, done);
    expect(isF2lTrainingComplete(target, brokenProtected.pattern)).toBe(false);
    expect(isF2lTrainingComplete(target, done.applyAlg(new Alg("U")))).toBe(false);
  });

  it("keeps Advanced slice references valid and uses the generic setup seam for authoritative slice setups", () => {
    const entry = F2L_TRAINING_CATALOGUES.advanced.cases.find((candidate) => candidate.name === "AF2L 1")!;
    const target = buildF2lCatalogueTarget(kpuzzle, entry, "BR");
    expect(f2lCatalogueSetupMoves(entry, "BR")).toBeNull();
    expect(referenceExecutionSignature(target.info.references[0].alg)).not.toBeNull();
    expect(isF2lTrainingComplete(target, solveReference(target, target.info.references[0].alg))).toBe(true);
  });
});
