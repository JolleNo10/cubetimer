import { Alg } from "cubing/alg";
import { describe, expect, it } from "vitest";
import {
  CENTER_FACELETS,
  CORNER_FACELETS,
  EDGE_FACELETS,
  patternToFacelets,
} from "./facelets";
import { F2L_CASES, F2L_POSITIONS } from "./f2lCases";
import {
  buildStandardF2lCaseState,
  buildStandardF2lTarget,
  standardF2lTrainingRotation,
} from "./f2lTraining";
import { FACE_OFFSET, EDGES_OF_FACE, f2lSlotsForCrossFace } from "./moves";
import { faceAtPosition } from "./orientation";
import { get3x3x3 } from "./puzzle";
import { buildF2lThumbnailModel } from "./f2lThumbnail";

const kpuzzle = await get3x3x3();

function displayPattern(pattern: ReturnType<typeof kpuzzle.defaultPattern>, tokens: readonly string[]) {
  return pattern.applyAlg(new Alg(tokens.join(" ")));
}

function expectPieceEmphasized(
  model: ReturnType<typeof buildF2lThumbnailModel>,
  pattern: ReturnType<typeof kpuzzle.defaultPattern>,
  piece: number,
  orbit: "CORNERS" | "EDGES",
) {
  const pieces = pattern.patternData[orbit].pieces;
  const slot = pieces.indexOf(piece);
  const facelets = orbit === "CORNERS" ? CORNER_FACELETS[slot] : EDGE_FACELETS[slot];
  expect(facelets.every((index) => model.emphasized[index]), `${orbit} piece ${piece}`).toBe(true);
}

function isSolvedSlot(
  pattern: ReturnType<typeof kpuzzle.defaultPattern>,
  slot: { corner: number; edge: number },
): boolean {
  const { CORNERS, EDGES } = pattern.patternData;
  return (
    CORNERS.pieces[slot.corner] === slot.corner &&
    CORNERS.orientation[slot.corner] === 0 &&
    EDGES.pieces[slot.edge] === slot.edge &&
    EDGES.orientation[slot.edge] === 0
  );
}

describe("F2L thumbnail models", () => {
  it("builds every case in every training position", () => {
    for (const f2lCase of F2L_CASES) {
      for (const position of F2L_POSITIONS) {
        const model = buildF2lThumbnailModel(kpuzzle, f2lCase, position);
        expect(model.facelets, `${f2lCase.name} ${position}`).toHaveLength(54);
        expect(model.emphasized, `${f2lCase.name} ${position}`).toHaveLength(54);
      }
    }
  });

  it("uses the white-bottom green-front training grip", () => {
    const rotation = standardF2lTrainingRotation();
    for (const position of F2L_POSITIONS) {
      const model = buildF2lThumbnailModel(kpuzzle, F2L_CASES[9], position);
      expect(model.facelets[FACE_OFFSET.U + 4], position).toBe(
        faceAtPosition(rotation.orientation, "U"),
      );
      expect(model.facelets[FACE_OFFSET.F + 4], position).toBe(
        faceAtPosition(rotation.orientation, "F"),
      );
      expect(model.facelets[FACE_OFFSET.R + 4], position).toBe(
        faceAtPosition(rotation.orientation, "R"),
      );
      expect(CENTER_FACELETS.every((index) => model.emphasized[index]), position).toBe(true);
    }
  });

  it("keeps the actual target pair emphasized after display rotation", () => {
    const rotation = standardF2lTrainingRotation();
    for (const position of F2L_POSITIONS) {
      const f2lCase = F2L_CASES[9];
      const state = buildStandardF2lCaseState(kpuzzle, f2lCase, position);
      const model = buildF2lThumbnailModel(kpuzzle, f2lCase, position);
      const target = f2lSlotsForCrossFace("U").find((slot) => slot.name === state.slot);
      if (!target) throw new Error(`Missing target slot ${state.slot}`);
      const displayed = displayPattern(state.pattern, rotation.tokens);
      expectPieceEmphasized(
        model,
        displayed,
        state.pattern.patternData.CORNERS.pieces[target.corner],
        "CORNERS",
      );
      expectPieceEmphasized(
        model,
        displayed,
        state.pattern.patternData.EDGES.pieces[target.edge],
        "EDGES",
      );
    }
  });

  it("mutes unrelated last-layer stickers while retaining solved structure", () => {
    const f2lCase = F2L_CASES[9];
    const model = buildF2lThumbnailModel(kpuzzle, f2lCase, "FR");
    expect(model.emphasized.some((emphasized) => !emphasized)).toBe(true);

    const solvedCase = F2L_CASES[40];
    const solvedModel = buildF2lThumbnailModel(kpuzzle, solvedCase, "FR");
    const state = buildStandardF2lCaseState(kpuzzle, solvedCase, "FR");
    const displayed = displayPattern(state.pattern, state.trainingRotation.tokens);
    const solvedCrossPieces = EDGES_OF_FACE.U.map(
      (slot) => state.pattern.patternData.EDGES.pieces[slot],
    );
    const solvedF2lSlot = f2lSlotsForCrossFace("U").find(
      (slot) => slot.name !== state.slot && isSolvedSlot(state.pattern, slot),
    );
    if (!solvedF2lSlot) throw new Error("Expected a solved non-target F2L slot");

    for (const piece of solvedCrossPieces) {
      expectPieceEmphasized(solvedModel, displayed, piece, "EDGES");
    }
    expectPieceEmphasized(
      solvedModel,
      displayed,
      state.pattern.patternData.CORNERS.pieces[solvedF2lSlot.corner],
      "CORNERS",
    );
    expectPieceEmphasized(
      solvedModel,
      displayed,
      state.pattern.patternData.EDGES.pieces[solvedF2lSlot.edge],
      "EDGES",
    );
  });

  it("shares state construction with the full standard target and changes by position", () => {
    const f2lCase = F2L_CASES[9];
    const patterns = F2L_POSITIONS.map((position) => {
      const state = buildStandardF2lCaseState(kpuzzle, f2lCase, position);
      const target = buildStandardF2lTarget(kpuzzle, f2lCase, position);
      const model = buildF2lThumbnailModel(kpuzzle, f2lCase, position);
      expect(patternToFacelets(state.pattern)).toBe(patternToFacelets(target.pattern));
      expect(state.slot).toBe(target.info.slot);
      expect(model.facelets).toBe(
        patternToFacelets(displayPattern(target.pattern, target.info.trainingRotation.tokens)),
      );
      return patternToFacelets(state.pattern);
    });

    expect(new Set(patterns).size).toBeGreaterThan(1);
  });
});
