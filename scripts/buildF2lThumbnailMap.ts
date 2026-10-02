/**
 * Rebuild: node node_modules/vite-node/vite-node.mjs --script scripts/buildF2lThumbnailMap.ts
 * Append --check to verify the checked-in map without writing it.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { CORNER_FACELETS, EDGE_FACELETS, patternToFacelets, SOLVED_FACELETS } from "../src/cube/facelets";
import { F2L_POSITIONS, type F2lPosition } from "../src/cube/f2lCases";
import { f2lTrainingCatalogue, type F2lTrainingCase, type F2lTrainingLibrary } from "../src/cube/f2lTrainingCases";
import { buildF2lCatalogueCaseState, type F2lCatalogueCaseState } from "../src/cube/f2lTraining";
import { EDGES_OF_FACE, FACE_OFFSET, FACES, f2lSlotsForCrossFace, type Face } from "../src/cube/moves";
import { get3x3x3 } from "../src/cube/puzzle";

function cornerSolved(pattern: F2lCatalogueCaseState["pattern"], corner: number): boolean {
  const { CORNERS } = pattern.patternData;
  return CORNERS.pieces[corner] === corner && CORNERS.orientation[corner] === 0;
}

function edgeSolved(pattern: F2lCatalogueCaseState["pattern"], edge: number): boolean {
  const { EDGES } = pattern.patternData;
  return EDGES.pieces[edge] === edge && EDGES.orientation[edge] === 0;
}

function faceletOnFace(index: number, face: Face): boolean {
  return index >= FACE_OFFSET[face] && index < FACE_OFFSET[face] + 9;
}

function addStickers(
  coloured: Set<number>,
  stickers: readonly number[],
  sideFaces?: readonly Face[],
): void {
  for (const index of stickers) {
    if (!sideFaces || sideFaces.some((face) => faceletOnFace(index, face))) coloured.add(index);
  }
}

/** Build the state-derived teaching mask shared by Basic and Advanced thumbnails. */
export function buildF2lTeachingMask(
  state: F2lCatalogueCaseState,
  displayPattern: F2lCatalogueCaseState["pattern"],
  targetSlot: { corner: number; edge: number },
): number[] {
  const displayFacelets = patternToFacelets(displayPattern);
  const targetEdgeColours = EDGE_FACELETS[targetSlot.edge].map((index) => SOLVED_FACELETS[index]);
  const targetSideFaces = FACES.filter((face) =>
    targetEdgeColours.includes(displayFacelets[FACE_OFFSET[face] + 4]),
  );
  assert.equal(targetSideFaces.length, 2, `Expected two target side faces for ${state.slot}`);

  const coloured = new Set<number>();
  const displayedCorners = displayPattern.patternData.CORNERS.pieces;
  const displayedEdges = displayPattern.patternData.EDGES.pieces;

  // The target pair is always visible, wherever its home cubies currently are.
  const displayedCornerSlot = displayedCorners.indexOf(targetSlot.corner);
  const displayedEdgeSlot = displayedEdges.indexOf(targetSlot.edge);
  assert(displayedCornerSlot >= 0, `Missing target corner for ${state.slot}`);
  assert(displayedEdgeSlot >= 0, `Missing target edge for ${state.slot}`);
  addStickers(coloured, CORNER_FACELETS[displayedCornerSlot]);
  addStickers(coloured, EDGE_FACELETS[displayedEdgeSlot]);

  // Only the two side-face centres and the solved first-two-layer foundation contribute context.
  for (const face of targetSideFaces) coloured.add(FACE_OFFSET[face] + 4);
  for (const edge of EDGES_OF_FACE.U) {
    if (!edgeSolved(state.pattern, edge)) continue;
    const displayedSlot = displayedEdges.indexOf(edge);
    assert(displayedSlot >= 0, `Missing solved cross edge ${edge} for ${state.slot}`);
    addStickers(coloured, EDGE_FACELETS[displayedSlot], targetSideFaces);
  }
  for (const slot of f2lSlotsForCrossFace("U")) {
    if (slot.corner !== targetSlot.corner && cornerSolved(state.pattern, slot.corner)) {
      const displayedCorner = displayedCorners.indexOf(slot.corner);
      assert(displayedCorner >= 0, `Missing solved F2L corner ${slot.corner} for ${state.slot}`);
      addStickers(coloured, CORNER_FACELETS[displayedCorner], targetSideFaces);
    }
    if (slot.edge !== targetSlot.edge && edgeSolved(state.pattern, slot.edge)) {
      const displayedEdge = displayedEdges.indexOf(slot.edge);
      assert(displayedEdge >= 0, `Missing solved F2L edge ${slot.edge} for ${state.slot}`);
      addStickers(coloured, EDGE_FACELETS[displayedEdge], targetSideFaces);
    }
  }

  return [...coloured].sort((a, b) => a - b);
}

/** Identify home cubies, then locate them after the physical display rotation. */
export function buildStoredF2lThumbnail(kpuzzle: KPuzzle, f2lCase: F2lTrainingCase, position: F2lPosition) {
  const state = buildF2lCatalogueCaseState(kpuzzle, f2lCase, position);
  const target = f2lSlotsForCrossFace("U").find((candidate) => candidate.name === state.slot);
  assert(target, `Missing target slot ${state.slot} for ${f2lCase.name} ${position}`);

  const displayPattern = state.pattern.applyAlg(new Alg(state.trainingRotation.tokens.join(" ")));
  const facelets = patternToFacelets(displayPattern);
  const coloured = buildF2lTeachingMask(state, displayPattern, target);
  assert.equal(facelets.length, 54);
  assert(coloured.every((index) => Number.isInteger(index) && index >= 0 && index < 54));
  return { facelets, coloured };
}

export function renderF2lThumbnailMap(kpuzzle: KPuzzle, library: F2lTrainingLibrary = "basic"): string {
  const cases = f2lTrainingCatalogue(library).cases;
  assert.equal(cases.length, library === "basic" ? 41 : 54);
  assert.equal(F2L_POSITIONS.length, 4);
  const entries: string[] = [];
  let count = 0;
  for (const f2lCase of cases) {
    entries.push(`  ${JSON.stringify(f2lCase.name)}: {`);
    for (const position of F2L_POSITIONS) {
      const stored = buildStoredF2lThumbnail(kpuzzle, f2lCase, position);
      entries.push(`    ${position}: ${JSON.stringify(stored)},`);
      count++;
    }
    entries.push("  },");
  }
  assert.equal(count, library === "basic" ? 164 : 216);
  const types = library === "basic" ? [
    "export type StoredF2lThumbnail = {",
    "  facelets: string;",
    "  coloured: readonly number[];",
    "};",
    "",
  ] : [];
  return [
    "// Generated by scripts/buildF2lThumbnailMap.ts. Do not edit by hand.",
    'import type { F2lPosition } from "./f2lCases";',
    ...(library === "advanced" ? ['import type { StoredF2lThumbnail } from "./f2lThumbnailMap.generated";'] : []),
    "",
    ...types,
    `export const ${library === "basic" ? "F2L_THUMBNAIL_MAP" : "ADVANCED_F2L_THUMBNAIL_MAP"}: Readonly<Record<string, Readonly<Record<F2lPosition, StoredF2lThumbnail>>>> = {`,
    ...entries,
    "};",
    "",
  ].join("\n");
}

// Importing the generator for semantic tests never writes the map.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kpuzzle = await get3x3x3();
  for (const library of ["basic", "advanced"] as const) {
    const filename = library === "basic" ? "f2lThumbnailMap.generated.ts" : "advancedF2lThumbnailMap.generated.ts";
    const output = new URL(`../src/cube/${filename}`, import.meta.url);
    const source = renderF2lThumbnailMap(kpuzzle, library);
    if (process.argv.includes("--check")) {
      assert.equal(readFileSync(output, "utf8").replace(/\r\n/g, "\n"), source, `${library} F2L thumbnail map is stale; regenerate it`);
      console.log(`${library} F2L thumbnail map is current (${library === "basic" ? 164 : 216} entries).`);
    } else {
      writeFileSync(output, source, "utf8");
      console.log(`Generated ${library} F2L thumbnail map (${library === "basic" ? 164 : 216} entries).`);
    }
  }
}
