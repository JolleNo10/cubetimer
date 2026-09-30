import { Alg } from "cubing/alg";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStoredF2lThumbnail, renderF2lThumbnailMap } from "../../scripts/buildF2lThumbnailMap";
import { CENTER_FACELETS, CORNER_FACELETS, EDGE_FACELETS, patternToFacelets } from "./facelets";
import { F2L_POSITIONS, f2lPositionTransform, type F2lPosition } from "./f2lCases";
import { reframe } from "./recognise";
import { F2L_TRAINING_CATALOGUES, findF2lTrainingCase, type F2lTrainingLibrary } from "./f2lTrainingCases";
import { ADVANCED_F2L_THUMBNAIL_MAP } from "./advancedF2lThumbnailMap.generated";
import { buildF2lCatalogueCaseState, standardF2lTrainingRotation, type F2lCatalogueCaseState } from "./f2lTraining";
import { FACE_OFFSET, f2lSlotsForCrossFace } from "./moves";
import { FACE_COLOURS } from "./colours";
import { slotInCubeFrame } from "./orientation";
import { get3x3x3 } from "./puzzle";
import { F2L_THUMBNAIL_MAP } from "./f2lThumbnailMap.generated";
import { getF2lThumbnailModel } from "./f2lThumbnail";

const kpuzzle = await get3x3x3();
const BASIC_CASES = F2L_TRAINING_CATALOGUES.basic.cases;

const EXPECTED_PAIRS = {
  FR: { slot: "FL", corner: 3, edge: 9, colours: ["U", "F", "L"] },
  FL: { slot: "FR", corner: 0, edge: 8, colours: ["U", "F", "R"] },
  BL: { slot: "BR", corner: 1, edge: 10, colours: ["U", "B", "R"] },
  BR: { slot: "BL", corner: 2, edge: 11, colours: ["U", "B", "L"] },
} as const;

function targetPieceIds(state: F2lCatalogueCaseState) {
  const target = f2lSlotsForCrossFace("U").find((candidate) => candidate.name === state.slot);
  if (!target) throw new Error(`Missing target slot ${state.slot}`);
  return { corner: target.corner, edge: target.edge };
}

function validateThumbnail(caseName: string, position: F2lPosition, library: F2lTrainingLibrary = "basic") {
  const f2lCase = findF2lTrainingCase(library, caseName);
  if (!f2lCase) throw new Error(`Missing case ${caseName}`);
  const map = library === "basic" ? F2L_THUMBNAIL_MAP : ADVANCED_F2L_THUMBNAIL_MAP;
  const stored = map[caseName]?.[position];
  expect(stored).toBeDefined();
  expect(stored).toEqual(buildStoredF2lThumbnail(kpuzzle, f2lCase, position));
  const state = buildF2lCatalogueCaseState(kpuzzle, f2lCase, position);
  const target = targetPieceIds(state);
  const displayed = state.pattern.applyAlg(new Alg(state.trainingRotation.tokens.join(" ")));
  expect(stored.facelets).toBe(patternToFacelets(displayed));
  expect(stored.facelets).toHaveLength(54);
  expect(stored.emphasized).toHaveLength(11);
  const emphasized = new Set(stored.emphasized);
  expect(emphasized.size).toBe(11);
  expect(CENTER_FACELETS.every((index) => emphasized.has(index))).toBe(true);
  expect(stored.facelets[FACE_OFFSET.U + 4]).toBe("D");
  expect(stored.facelets[FACE_OFFSET.F + 4]).toBe("F");
  expect(stored.facelets[FACE_OFFSET.R + 4]).toBe("L");

  for (const orbit of ["CORNERS", "EDGES"] as const) {
    const targetPiece = orbit === "CORNERS" ? target.corner : target.edge;
    const mappings = orbit === "CORNERS" ? CORNER_FACELETS : EDGE_FACELETS;
    const pieces = displayed.patternData[orbit].pieces;
    expect(pieces.indexOf(targetPiece)).toBeGreaterThanOrEqual(0);
    pieces.forEach((piece, slot) => {
      for (const index of mappings[slot]) {
        expect(emphasized.has(index), `${orbit} piece ${piece}, sticker ${index}`).toBe(piece === targetPiece);
      }
    });
  }

  const targetIndices = stored.emphasized.filter((index) => !CENTER_FACELETS.includes(index));
  expect(targetIndices).toHaveLength(5);
  const expected = EXPECTED_PAIRS[position];
  expect(new Set(targetIndices.map((index) => stored.facelets[index]))).toEqual(new Set(expected.colours));
  expect(state.slot).toBe(expected.slot);
  expect(target).toEqual({ corner: expected.corner, edge: expected.edge });

  const model = getF2lThumbnailModel(library, caseName, position);
  expect(model.facelets).toBe(stored.facelets);
  expect(model.emphasized).toHaveLength(54);
  expect(model.emphasized).toEqual(Array.from({ length: 54 }, (_, index) => emphasized.has(index)));
}

describe("F2L thumbnail named FR regressions", () => {
  it.each(["F2L 1", "F2L 6", "F2L 10", "F2L 25", "F2L 31", "F2L 37"])(
    "%s FR highlights only its home pair and centres",
    (caseName) => validateThumbnail(caseName, "FR"),
  );
});

describe("F2L thumbnail Front Right colour invariant", () => {
  it.each(BASIC_CASES.map((f2lCase) => f2lCase.name))(
    "%s FR has exactly white/green/orange target stickers",
    (caseName) => validateThumbnail(caseName, "FR"),
  );
});

describe("F2L thumbnail semantics for all four positions", () => {
  it.each(BASIC_CASES.flatMap((f2lCase) => F2L_POSITIONS.map((position) => [f2lCase.name, position] as const)))(
    "%s %s highlights exactly its home pair and centres",
    (name, position) => validateThumbnail(name, position),
  );

  it.each(F2L_POSITIONS)("F2L 10 %s protects the position mapping", (position) => {
    validateThumbnail("F2L 10", position);
    expect(slotInCubeFrame(standardF2lTrainingRotation().orientation, position)).toBe(EXPECTED_PAIRS[position].slot);
  });

  it("anchors the standard grip to yellow/green/orange/red/blue/white", () => {
    const stored = buildStoredF2lThumbnail(kpuzzle, BASIC_CASES[0], "FR");
    const faces = ["U", "F", "R", "L", "B", "D"] as const;
    expect(faces.map((face) => stored.facelets[FACE_OFFSET[face] + 4])).toEqual(["D", "F", "L", "R", "B", "U"]);
    expect(faces.map((face) => FACE_COLOURS[stored.facelets[FACE_OFFSET[face] + 4] as typeof face].name)).toEqual(
      ["yellow", "green", "orange", "red", "blue", "white"],
    );
  });

  it("stores exactly 41 cases with all four positions (164 entries)", () => {
    expect(Object.keys(F2L_THUMBNAIL_MAP).sort()).toEqual(BASIC_CASES.map((f2lCase) => f2lCase.name).sort());
    expect(Object.keys(F2L_THUMBNAIL_MAP)).toHaveLength(41);
    for (const positions of Object.values(F2L_THUMBNAIL_MAP)) {
      expect(Object.keys(positions)).toEqual([...F2L_POSITIONS]);
    }
    expect(Object.values(F2L_THUMBNAIL_MAP).flatMap(Object.values)).toHaveLength(164);
  });

  it("keeps F2L 10's four positional states distinct", () => {
    expect(new Set(F2L_POSITIONS.map((position) => F2L_THUMBNAIL_MAP["F2L 10"][position].facelets)).size).toBe(4);
  });

  it("highlights F2L 10 FR's displaced home cubies rather than target-slot occupants", () => {
    const state = buildF2lCatalogueCaseState(kpuzzle, BASIC_CASES[9], "FR");
    const target = targetPieceIds(state);
    expect([
      state.pattern.patternData.CORNERS.pieces[target.corner],
      state.pattern.patternData.EDGES.pieces[target.edge],
    ]).not.toEqual([target.corner, target.edge]);
    validateThumbnail("F2L 10", "FR");
  });

  it("is deterministic and matches the checked-in generated source", () => {
    const source = renderF2lThumbnailMap(kpuzzle);
    expect(renderF2lThumbnailMap(kpuzzle)).toBe(source);
    expect(readFileSync(new URL("./f2lThumbnailMap.generated.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")).toBe(source);
  });

  it("fails explicitly for a missing case", () => {
    expect(() => getF2lThumbnailModel("basic", "F2L 42", "FR")).toThrow("Missing F2L thumbnail F2L 42 FR");
  });
});

describe("Advanced F2L thumbnail semantics", () => {
  const cases = F2L_TRAINING_CATALOGUES.advanced.cases;
  it.each(cases.flatMap((entry) => F2L_POSITIONS.map((position) => [entry.name, position] as const)))(
    "%s %s highlights only its actual home pair and centres",
    (name, position) => validateThumbnail(name, position, "advanced"),
  );

  it("stores exactly 216 geometrically positioned Advanced thumbnails", () => {
    expect(Object.keys(ADVANCED_F2L_THUMBNAIL_MAP).sort()).toEqual(cases.map((entry) => entry.name).sort());
    expect(Object.values(ADVANCED_F2L_THUMBNAIL_MAP).flatMap(Object.values)).toHaveLength(216);
    for (const positions of Object.values(ADVANCED_F2L_THUMBNAIL_MAP)) {
      expect(Object.keys(positions)).toEqual([...F2L_POSITIONS]);
    }
  });

  it.each(F2L_POSITIONS)("all 54 thumbnails selected for %s highlight that destination's home pair", (position) => {
    for (const entry of cases) validateThumbnail(entry.name, position, "advanced");
  });

  it.each([
    ["AF2L 1", "S R S'", "BR"],
    ["AF2L 2", "L U2' L' R U R'", "BL"],
    ["AF2L 3", "L F' L' F U' R U R'", "FL"],
  ] as const)("%s thumbnails originate from the published setup, not an inverse reference", (name, setup, canonicalTarget) => {
    const published = kpuzzle.defaultPattern().applyAlg(new Alg(setup));
    const grip = new Alg(standardF2lTrainingRotation().tokens.join(" "));
    for (const position of F2L_POSITIONS) {
      const positioned = reframe(kpuzzle, published, f2lPositionTransform(canonicalTarget, position).invert());
      const cubePattern = reframe(kpuzzle, positioned, grip.invert());
      expect(ADVANCED_F2L_THUMBNAIL_MAP[name][position].facelets)
        .toBe(patternToFacelets(cubePattern.applyAlg(grip)));
    }
  });

  it("highlights trapped cubies in other F2L slots, not destination occupants", () => {
    let trapped = 0;
    for (const entry of cases) {
      for (const position of F2L_POSITIONS) {
        const state = buildF2lCatalogueCaseState(kpuzzle, entry, position);
        const target = targetPieceIds(state);
        const cornerSlot = state.pattern.patternData.CORNERS.pieces.indexOf(target.corner);
        const edgeSlot = state.pattern.patternData.EDGES.pieces.indexOf(target.edge);
        if (f2lSlotsForCrossFace("U").some((slot) =>
          (slot.corner === cornerSlot && cornerSlot !== target.corner) ||
          (slot.edge === edgeSlot && edgeSlot !== target.edge))) {
          trapped++;
          validateThumbnail(entry.name, position, "advanced");
        }
      }
    }
    expect(trapped).toBeGreaterThan(0);
  });

  it("generates deterministic Advanced data matching the checked-in map", () => {
    const source = renderF2lThumbnailMap(kpuzzle, "advanced");
    expect(renderF2lThumbnailMap(kpuzzle, "advanced")).toBe(source);
    expect(readFileSync(new URL("./advancedF2lThumbnailMap.generated.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")).toBe(source);
  });
});
