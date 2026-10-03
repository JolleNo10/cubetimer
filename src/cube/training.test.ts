import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import { get3x3x3 } from "./puzzle";
import { reframe, withCentresHome } from "./recognise";
import { rotationForGrip, IDENTITY } from "./orientation";
import { advanceTrainingGuide, buildTrainingGuide, standardTrainingRotation, trainingGuideMove, trainingGuideProgress } from "./training";
import { buildF2lCatalogueTarget } from "./f2lTraining";
import { F2L_TRAINING_CATALOGUES } from "./f2lTrainingCases";
import { buildLastLayerCatalogueTarget, lastLayerCaseIds } from "./lastLayerTraining";
import { F2L_POSITIONS } from "./f2lCases";

const kpuzzle = await get3x3x3();
const start = kpuzzle.defaultPattern().applyAlg("F R U");
const identityRotation = { tokens: [], orientation: IDENTITY };
function guideFor(algorithm: string) {
  return buildTrainingGuide(start, { trainingRotation: identityRotation, references: [{ alg: algorithm, stm: 0 }] })!;
}

describe("shared Training checkpoints", () => {
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
