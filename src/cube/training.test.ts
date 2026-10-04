import { Alg, Move } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { get3x3x3 } from "./puzzle";
import { reframe, withCentresHome } from "./recognise";
import { patternToFacelets } from "./facelets";
import { rotationForGrip, IDENTITY } from "./orientation";
import { algorithmStm, calculateTrainingEfficiency, referenceExecutionSignature, advanceTrainingGuide, buildTrainingGuide, standardTrainingRotation, trainingGuideMove, trainingGuideProgress } from "./training";
import { buildF2lCatalogueTarget } from "./f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "./f2lTrainingCases";
import { buildLastLayerCatalogueTarget, isLastLayerTrainingComplete, lastLayerCaseIds } from "./lastLayerTraining";
import { F2L_POSITIONS } from "./f2lCases";

import { TWO_LOOK_CASES } from "./lastLayerTwoLookCases";

const kpuzzle = await get3x3x3();
const start = kpuzzle.defaultPattern().applyAlg("F R U");
const identityRotation = { tokens: [], orientation: IDENTITY };
function guideFor(algorithm: string) {
  return buildTrainingGuide(start, { trainingRotation: identityRotation, references: [{ alg: algorithm, stm: 0 }] })!;
}

describe("shared Training checkpoints", () => {
  it("projects checkpoints back to the normal input frame, including a non-identity Training grip", () => {
    const trainingRotation = rotationForGrip("R", "B")!;
    const guide = buildTrainingGuide(start, { trainingRotation, references: [{ alg: "R U", stm: 2 }] })!;
    expect(guide.checkpointFacelets).toHaveLength(guide.moves.length + 1);
    expect(guide.checkpointFacelets[0]).toBe(patternToFacelets(start));
    expect(guide.checkpointFacelets[0]).not.toBe(patternToFacelets(guide.checkpoints[0]));
    for (const confirmed of [0, 1, 2]) {
      const progress = trainingGuideProgress(guide, confirmed);
      expect(progress.checkpointFacelets).toBe(guide.checkpointFacelets);
      expect(progress.guideMoves).toBe(guide.guideMoves);
    }
  });

  it("shows the state before each ordinary instruction, plus the final reference state", () => {
    expect(guideFor("R U").checkpointFacelets).toEqual([
      patternToFacelets(start), patternToFacelets(start.applyMove("R")), patternToFacelets(start.applyAlg("R U")),
    ]);
  });

  it.each(["M", "M'", "E", "S", "r"])("projects %s through normalized checkpoint semantics", token => {
    const guide = guideFor(`${token} U`);
    expect(guide.checkpointFacelets[1]).not.toBe(guide.checkpointFacelets[0]);
    expect(guide.checkpointFacelets[1]).toBe(patternToFacelets(withCentresHome(kpuzzle, start.applyMove(token))));
  });

  it("keeps rotation checkpoints and subsequent arrows in one fixed display frame", () => {
    const guide = guideFor("y R U");
    expect(guide.checkpointFacelets[1]).toBe(guide.checkpointFacelets[0]);
    expect(guide.guideMoves[1]).toMatchObject({ token: "R", axis: "z", layers: [-1, -1 / 3] });
    expect(guide.checkpointFacelets[2]).toBe(patternToFacelets(start.applyMove("B")));
    expect(guide.checkpointFacelets[2]).toBe(patternToFacelets(withCentresHome(kpuzzle, start.applyAlg("y R"))));
  });

  it("advances outer turns one checkpoint at a time, expanding cubing notation", () => {
    const guide = guideFor("(R U)2 R' U2");
    expect(guide.moves).toEqual(["R", "U", "R", "U", "R'", "U2"]);
    let pattern = start;
    let progress = trainingGuideProgress(guide);
    expect(progress).toMatchObject({ confirmed: 0, currentMove: { token: "R" }, finished: false });
    for (const [index, token] of guide.moves.entries()) {
      pattern = pattern.applyMove(token);
      progress = advanceTrainingGuide(guide, pattern, progress.confirmed);
      expect(progress.confirmed).toBe(index + 1);
    }
    expect(progress).toMatchObject({ currentMove: null, finished: true });
  });

  it("retains the last checkpoint through deviations and rejoins a later state", () => {
    const guide = guideFor("R U F L");
    const first = start.applyMove("R");
    expect(advanceTrainingGuide(guide, first, 0).confirmed).toBe(1);
    expect(advanceTrainingGuide(guide, first.applyMove("B"), 1).confirmed).toBe(1);
    expect(advanceTrainingGuide(guide, start.applyAlg("R U F"), 1).confirmed).toBe(3);
    expect(advanceTrainingGuide(guide, start, 3).confirmed).toBe(3);
  });

  it.each(["r", "r'", "r2", "f", "f'", "f2", "l", "u", "d", "b", "Rw", "Lw", "Uw", "Dw", "Fw", "Bw", "M", "M'", "M2", "E", "S"])(
    "confirms %s from its normalized cube state", (token) => {
      const guide = guideFor(`${token} U R`);
      const physical = withCentresHome(kpuzzle, start.applyMove(token));
      expect(advanceTrainingGuide(guide, physical, 0).confirmed).toBe(1);
    },
  );

  it("confirms a wide/slice checkpoint from equivalent reported outer-face turns", () => {
    expect(advanceTrainingGuide(guideFor("r U"), start.applyMove("L"), 0).confirmed).toBe(1);
    expect(advanceTrainingGuide(guideFor("f U"), start.applyMove("B"), 0).confirmed).toBe(1);
    expect(advanceTrainingGuide(guideFor("M U"), start.applyAlg("L' R"), 0).confirmed).toBe(1);
  });

  it.each(["x", "y", "z"])("keeps %s visible and permits unreported rotations to be skipped", (rotation) => {
    const algorithm = `${rotation} R U ${rotation}' F`;
    const guide = guideFor(algorithm);
    expect(trainingGuideProgress(guide).currentMove?.kind).toBe("rotation");
    const later = withCentresHome(kpuzzle, start.applyAlg(`${rotation} R U`));
    expect(advanceTrainingGuide(guide, later, 0).confirmed).toBeGreaterThanOrEqual(3);
    expect(advanceTrainingGuide(guide, withCentresHome(kpuzzle, start.applyAlg(algorithm)), 0).finished).toBe(true);
  });

  it("maps post-rotation arrows to the fixed solver-facing display", () => {
    const guide = guideFor("y R U");
    expect(guide.guideMoves[1]).toMatchObject({ axis: "z", layers: [-1, -1 / 3], token: "R" });
    const progress = trainingGuideProgress(guide);
    expect(progress.moves).toBe(guide.moves);
    expect(progress.guideMoves).toBe(guide.guideMoves);
    expect(progress.guideMoves[1]).not.toEqual(trainingGuideMove("R"));
  });

  it.each([
    ["r", "L", "F", "z", [1 / 3, 1]],
    ["f", "B", "L", "x", [-1, -1 / 3]],
    ["M", "L' R", "B", "z", [-1, -1 / 3]],
  ] as const)("maps the move after %s onto the center-fixed smart-cube display", (token, outer, next, axis, layers) => {
    const guide = guideFor(`${token} U R`);
    const reported = start.applyAlg(`${outer} ${next}`);
    const normalized = withCentresHome(kpuzzle, start.applyAlg(`${token} U`));
    expect([normalized.patternData.CORNERS, normalized.patternData.EDGES])
      .toEqual([reported.patternData.CORNERS, reported.patternData.EDGES]);
    expect(guide.guideMoves[1]).toMatchObject({ token: "U", axis, layers });
    expect(trainingGuideProgress(guide).guideMoves).toBe(guide.guideMoves);
    expect(advanceTrainingGuide(guide, reported, 0).confirmed).toBe(2);
  });

  it("shows an intermediate rotation and advances beyond it on the next piece checkpoint", () => {
    const guide = guideFor("R y U F");
    const first = advanceTrainingGuide(guide, start.applyMove("R"), 0);
    expect(first).toMatchObject({ confirmed: 1, currentMove: { token: "y", kind: "rotation" } });
    const later = withCentresHome(kpuzzle, start.applyAlg("R y U"));
    expect(advanceTrainingGuide(guide, later, first.confirmed).confirmed).toBe(3);
  });

  it.each([standardTrainingRotation(), rotationForGrip("R", "B")!])("uses the exact target's Training frame", (trainingRotation) => {
    const algorithm = "r U M2 F'";
    const guide = buildTrainingGuide(start, { trainingRotation, references: [{ alg: algorithm, stm: 4 }] })!;
    const rotation = new Alg(trainingRotation.tokens.join(" "));
    const handStart = reframe(kpuzzle, start, rotation);
    const cubeState = reframe(kpuzzle, withCentresHome(kpuzzle, handStart.applyAlg(algorithm)), rotation.invert());
    expect(advanceTrainingGuide(guide, cubeState, 0).finished).toBe(true);
  });

  it("starts from the exact target even when its centers are rotated", () => {
    const trainingRotation = standardTrainingRotation();
    const targetPattern = start.applyMove("y");
    const guide = buildTrainingGuide(targetPattern, { trainingRotation, references: [{ alg: "R U F", stm: 3 }] })!;
    const rotation = new Alg(trainingRotation.tokens.join(" "));
    const handTarget = reframe(kpuzzle, targetPattern, rotation);
    const first = reframe(kpuzzle, handTarget.applyMove("R"), rotation.invert());
    expect(advanceTrainingGuide(guide, first, 0).confirmed).toBe(1);
  });

  it("uses one guide for F2L, Full OLL/PLL, and 2-Look OLL/PLL", () => {
    const targets = [buildF2lCatalogueTarget(kpuzzle, F2L_TRAINING_CATALOGUES.basic.cases[0]),
      buildLastLayerCatalogueTarget(kpuzzle, "oll", "27"), buildLastLayerCatalogueTarget(kpuzzle, "pll", "T"),
      buildLastLayerCatalogueTarget(kpuzzle, "oll", "L-Shape", 0, "2look"), buildLastLayerCatalogueTarget(kpuzzle, "pll", "H", 0, "2look")];
    for (const target of targets) {
      const guide = buildTrainingGuide(target.pattern, target.info)!;
      expect(guide.moves.length).toBeGreaterThan(0);
      const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
      const after = reframe(kpuzzle, withCentresHome(kpuzzle, reframe(kpuzzle, target.pattern, rotation)
        .applyAlg(target.info.references[0].alg)), rotation.invert());
      expect(advanceTrainingGuide(guide, after, 0).finished).toBe(true);
    }
  });

  it("builds guides for the checked-in recommended vocabulary in every Training catalogue", () => {
    for (const catalogue of Object.values(F2L_TRAINING_CATALOGUES)) {
      for (const entry of catalogue.cases) {
        for (const position of F2L_POSITIONS) {
          const target = buildF2lCatalogueTarget(kpuzzle, entry, position);
          if (!target.info.references.length) continue;
          expect(buildTrainingGuide(target.pattern, target.info), `${entry.name} ${position}`).not.toBeNull();
        }
      }
    }
    for (const family of ["oll", "pll"] as const) {
      for (const set of ["full", "2look"] as const) {
        for (const id of lastLayerCaseIds(family, set)) {
          const target = buildLastLayerCatalogueTarget(kpuzzle, family, id, 0, set);
          expect(buildTrainingGuide(target.pattern, target.info), `${family} ${set} ${id}`).not.toBeNull();
        }
      }
    }
  });

  it("omits absent, empty, or invalid references", () => {
    expect(buildTrainingGuide(start, { trainingRotation: identityRotation, references: [] })).toBeNull();
    expect(buildTrainingGuide(start, { trainingRotation: identityRotation, references: [{ alg: "", stm: 0 }] })).toBeNull();
    expect(buildTrainingGuide(start, { trainingRotation: identityRotation, references: [{ alg: "not an alg", stm: 0 }] })).toBeNull();
  });
});

describe("guide move semantics", () => {
  it("reverses prime direction and marks a half turn as direction-independent", () => {
    expect(trainingGuideMove("R")?.direction).toBe(-1);
    expect(trainingGuideMove("R'")?.direction).toBe(1);
    for (const move of ["R2", "M2", "r2"]) expect(trainingGuideMove(move)?.halfTurn).toBe(true);
  });

  it.each(["r", "f", "Rw", "Fw"])("shows %s as two layers", (token) => {
    expect(trainingGuideMove(token)).toMatchObject({ kind: "wide", layers: [-1 / 3, 1] });
  });

  it.each(["M", "E", "S"])("shows %s as the middle slice", (token) => {
    expect(trainingGuideMove(token)).toMatchObject({ kind: "slice", layers: [-1 / 3, 1 / 3] });
  });

  it("shows an outer face and whole cube with distinct extents", () => {
    expect(trainingGuideMove("R")).toMatchObject({ kind: "outer", layers: [1 / 3, 1] });
    expect(trainingGuideMove("x")).toMatchObject({ kind: "rotation", layers: [-1, 1] });
  });
});

const decompositions = [
  ["r", "x L"], ["l", "x' R"], ["u", "y D"], ["d", "y' U"],
  ["f", "z B"], ["b", "z' F"], ["M", "x' R L'"], ["E", "y' U D'"], ["S", "z F' B"],
] as const;

describe("Training reference path matching", () => {
  function classify(pattern: typeof start, algorithm: string, execution: string) {
    return calculateTrainingEfficiency(
      Array.from(new Alg(execution).expand().childAlgNodes()).map((node, t) => ({ move: node.toString(), t })),
      [{ rank: 1, alg: algorithm, stm: algorithmStm(algorithm) }],
      { pattern, trainingRotation: identityRotation },
    );
  }

  it.each([
    ["R U R'", "R U R'"],
    ["r U r'", "L F L'"],
    ["f U f'", "B L B'"],
    ["Rw U Rw'", "L F L'"],
    ["M U", "L' R B"],
    ["E U", "D' U U"],
    ["S U", "B F' L"],
    ["y R U", "B U"],
    ["R2 U", "R R U"],
    ["R2 U", "R' R' U"],
    ["R R U", "R2 U"],
  ])("recognizes %s through equivalent physical execution %s", (algorithm, execution) => {
    const expected = withCentresHome(kpuzzle, start.applyAlg(algorithm));
    expect([start.applyAlg(execution).patternData.CORNERS, start.applyAlg(execution).patternData.EDGES])
      .toEqual([expected.patternData.CORNERS, expected.patternData.EDGES]);
    expect(classify(start, algorithm, execution).matchedReferenceRank).toBe(1);
  });

  it("recognizes a real 2-Look PLL H with reordered and interleaved reported slice turns", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", "H", 0, "2look");
    const rotation = new Alg(target.info.trainingRotation.tokens.join(" "));
    for (const slice of ["L2 R2", "L R L R", "R' L R' L"]) {
      const execution = `${slice} D ${slice} U2 ${slice} D ${slice}`;
      const after = reframe(kpuzzle, reframe(kpuzzle, target.pattern, rotation).applyAlg(execution), rotation.invert());
      expect(isLastLayerTrainingComplete(target.info, after)).toBe(true);
      const result = calculateTrainingEfficiency(
        execution.split(" ").map((move, t) => ({ move, t })), target.info.references,
        { pattern: target.pattern, trainingRotation: target.info.trainingRotation },
      );
      expect(result).toMatchObject({ matchedReferenceRank: 1, stm: 7, delta: 0 });
    }
  });

  it("distinguishes a validated alternative from a custom solution that reaches the same goal", () => {
    const target = buildLastLayerCatalogueTarget(kpuzzle, "oll", "27");
    const alternative = target.info.references[1];
    expect(alternative.rank).toBe(2);
    const execution = referenceExecutionSignature(alternative.alg)!;
    const context = { pattern: target.pattern, trainingRotation: target.info.trainingRotation };
    const rotation = new Alg(context.trainingRotation.tokens.join(" "));
    const after = reframe(kpuzzle, reframe(kpuzzle, target.pattern, rotation).applyAlg(execution.join(" ")), rotation.invert());
    expect(isLastLayerTrainingComplete(target.info, after)).toBe(true);
    expect(calculateTrainingEfficiency(execution.map((move, t) => ({ move, t })), target.info.references, context)
      .matchedReferenceRank).toBe(2);
    const custom = ["F", "F'", ...execution];
    expect(calculateTrainingEfficiency(custom.map((move, t) => ({ move, t })), target.info.references, context)
      .matchedReferenceRank).toBeNull();
  });

  it("rejects a deviation that rejoins and finishes the recommended checkpoints", () => {
    const algorithm = "R U F";
    const execution = "R B B' U F";
    expect(start.applyAlg(execution).patternData).toEqual(start.applyAlg(algorithm).patternData);
    expect(advanceTrainingGuide(guideFor(algorithm), start.applyAlg(execution), 0).finished).toBe(true);
    expect(classify(start, algorithm, execution).matchedReferenceRank).toBeNull();
  });

  it("matches in the exact historical frame, including a rotated-center starting target", () => {
    expect(classify(start.applyMove("y"), "R U F", "R U F").matchedReferenceRank).toBe(1);
    const trainingRotation = rotationForGrip("R", "B")!;
    const target = buildLastLayerCatalogueTarget(kpuzzle, "pll", "H", 0, "2look");
    const result = calculateTrainingEfficiency(
      "L2 R2 D L2 R2 U2 L2 R2 D L2 R2".split(" ").map((move, t) => ({ move, t })),
      target.info.references,
      { pattern: reframe(kpuzzle, reframe(kpuzzle, target.pattern, new Alg(target.info.trainingRotation.tokens.join(" "))),
        new Alg(trainingRotation.tokens.join(" ")).invert()), trainingRotation },
    );
    expect(result.matchedReferenceRank).toBe(1);
  });
});

describe("Training reference execution signatures", () => {
  it.each(decompositions)("reduces %s and its inverse/double forms with cubing.js conventions", (family, decomposition) => {
    for (const amount of [1, -1, 2]) {
      const token = new Move(family, amount).toString();
      const expanded = new Alg(Array.from(new Alg(decomposition).childAlgNodes()).map((node) => {
        const move = node as Move;
        return new Move(move.quantum, move.amount * amount);
      }));
      expect(kpuzzle.algToTransformation(token).isIdentical(kpuzzle.algToTransformation(expanded)), token).toBe(true);
      const signature = referenceExecutionSignature(token);
      expect(signature, token).not.toBeNull();
      expect(signature, token).toEqual(referenceExecutionSignature(expanded.toString()));
      expect(signature!.length).toBeGreaterThan(0);
      for (const move of signature!) expect(move).toMatch(/^[URFDLB](2|'|2')?$/);
      if (family === family.toLowerCase()) {
        expect(referenceExecutionSignature(`${family.toUpperCase()}w${amount === -1 ? "'" : amount === 2 ? "2" : ""}`)).toEqual(signature);
      }
    }
  });

  it.each(Object.entries(TWO_LOOK_CASES).flatMap(([family, cases]) => cases.map((item) => ({ family, ...item }))))(
    "matches J Perm $family $id with authoritative STM",
    ({ algorithm }) => {
      const signature = referenceExecutionSignature(algorithm);
      expect(signature).not.toBeNull();
      for (const move of signature!) expect(move).toMatch(/^[URFDLB](2|'|2')?$/);
      const stm = algorithmStm(algorithm);
      const result = calculateTrainingEfficiency(signature!.map((move, index) => ({ move, t: index * 100 })), [{ rank: 1, alg: algorithm, stm }]);
      expect(result).toMatchObject({ matchedReferenceRank: 1, stm, recommendedStm: stm, delta: 0 });
    },
  );

  it("uses the matched alternative's STM and preserves observed STM for custom solutions", () => {
    const references = [{ rank: 1, alg: "M2 U M2 U2 M2 U M2", stm: 7 }, { rank: 2, alg: "M U M'", stm: 3 }];
    const moves = referenceExecutionSignature(references[1].alg)!.map((move, t) => ({ move, t }));
    expect(calculateTrainingEfficiency(moves, references)).toMatchObject({ matchedReferenceRank: 2, stm: 3, recommendedStm: 7, delta: -4 });
    expect(calculateTrainingEfficiency([{ move: "R", t: 0 }, { move: "U", t: 100 }], references)).toMatchObject({ matchedReferenceRank: null, stm: 2, delta: -5 });
  });
});
