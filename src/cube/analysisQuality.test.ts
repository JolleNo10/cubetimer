import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyseSolve, ANALYSIS_VERSION, isTrustedCfopAnalysis } from "./analysis";
import { get3x3x3 } from "./puzzle";
import { patternToFacelets } from "./facelets";
import * as slots from "./moves";
import * as recognise from "./recognise";

const puzzle = await get3x3x3();
const extracts = ["F U F' U'", "L U L' U'", "B U B' U'", "R U R' U'"];
const f2l = [...extracts].reverse().map(a => new Alg(a).invert().toString()).join(" ");
const oll = "R U R' U R U2' R'";
const pll = "R U R' U' R' F R2 U' R' U' R U R' F'";
const start = puzzle.defaultPattern().applyAlg(new Alg(pll).invert()).applyAlg(new Alg(oll).invert()).applyAlg(extracts.join(" "));
const timed = (alg: string) => Array.from(new Alg(alg).expand().childAlgNodes()).map((n, i) => ({ move: n.toString(), t: (i + 1) * 200 }));
const textbook = () => analyseSolve(start, timed(`${f2l} ${oll} ${pll}`), null, { observedStartBottomFace: "D" })!;
afterEach(() => vi.restoreAllMocks());

describe("CFOP quality", () => {
  it("keeps textbook CFOP trusted with explicit current quality", () => {
    const analysis = textbook();
    expect(ANALYSIS_VERSION).toBe(6);
    expect(analysis).toMatchObject({ crossFace: "D", analysisVersion: 6, quality: { status: "trusted", issues: [] } });
    expect(isTrustedCfopAnalysis(analysis)).toBe(true);
    expect(isTrustedCfopAnalysis({ ...analysis, quality: undefined })).toBe(false);
    expect(isTrustedCfopAnalysis({ ...analysis, analysisVersion: 2 })).toBe(false);
  });
  it("uses observed bottom to resolve otherwise ambiguous state progression", () => {
    const alg = "R2 F2 R2 F2";
    const moves = timed(alg), scrambled = puzzle.defaultPattern().applyAlg(new Alg(alg).invert());
    expect(analyseSolve(scrambled, moves)!.quality).toMatchObject({ status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["U", "D"] }] });
    expect(isTrustedCfopAnalysis(analyseSolve(scrambled, moves, null, { observedStartBottomFace: "D" }))).toBe(true);
  });
  it("marks an observed-bottom conflict with unique pre-solution state evidence", () => {
    const scrambled = puzzle.defaultPattern().applyAlg("R'");
    expect(isTrustedCfopAnalysis(analyseSolve(scrambled, timed("R")))).toBe(true);
    const analysis = analyseSolve(scrambled, timed("R"), null, { observedStartBottomFace: "D" })!;
    expect(analysis.crossFace).toBe("L");
    expect(analysis.quality).toEqual({ status: "suspect", issues: [{ code: "cross-face-conflict", observed: "D", inferred: "L", source: "solve-start" }] });
  });
  it("keeps only genuinely competing state interpretations in the ambiguity list", () => {
    const analysis = analyseSolve(puzzle.defaultPattern().applyAlg("M2"), timed("M2"))!;
    expect(analysis.quality).toEqual({ status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["R", "L"] }] });
  });
  it("requires restored Cross at F2L checkpoints and keeps shared checkpoints and null cases legitimate", () => {
    const h = "R2 D2 R D2 R2 D2 R2 D2 R D2 R2";
    const witness = start.applyAlg(`${h} ${f2l}`).patternData;
    expect(slots.f2lSlotsForCrossFace("D").every(s => witness.EDGES.pieces[s.edge] === s.edge && witness.CORNERS.pieces[s.corner] === s.corner)).toBe(true);
    expect(slots.EDGES_OF_FACE.D.every(e => witness.EDGES.pieces[e] === e)).toBe(false);
    const moves = timed(`${h} ${f2l} ${new Alg(h).invert()} ${oll} ${pll}`);
    const analysis = analyseSolve(start, moves, null, { observedStartBottomFace: "D" })!;
    expect(analysis.steps.slice(1, 5).map(s => s.toMove)).toEqual([38, 38, 38, 38]);
    expect(analysis.steps.slice(2, 5).every(s => s.skipped && s.case === null)).toBe(true);
    expect(isTrustedCfopAnalysis(analysis)).toBe(true);
  });
  it("requires full F2L to remain solved at OLL completion", () => {
    const moves = timed(`${f2l} D ${oll} D' ${pll}`);
    const disturbed = start.applyAlg(`${f2l} D ${oll}`);
    const witness = disturbed.patternData;
    expect(new Set(patternToFacelets(disturbed).slice(0, 9)).size).toBe(1);
    expect(slots.f2lSlotsForCrossFace("D").every(s => witness.CORNERS.pieces[s.corner] === s.corner)).toBe(false);
    const analysis = analyseSolve(start, moves, null, { observedStartBottomFace: "D" })!;
    expect(analysis.steps[5].toMove).toBe(25);
    expect(isTrustedCfopAnalysis(analysis)).toBe(true);
  });
  it("reports an unassignable slot rather than silently accepting the segmentation", () => {
    const original = slots.f2lSlotsForCrossFace;
    vi.spyOn(slots, "f2lSlotsForCrossFace").mockImplementation(face => original(face).map(slot => ({ ...slot, name: "FR" })));
    expect(textbook().quality).toMatchObject({ status: "suspect", issues: expect.arrayContaining([{ code: "unassigned-f2l-slot", step: "F2L Slot 2" }]) });
  });
  it.each(["recogniseOll", "recognisePll"] as const)("reports a non-skipped state rejected by %s", recognizer => {
    vi.spyOn(recognise, recognizer).mockReturnValue(null);
    expect(textbook().quality).toMatchObject({ status: "suspect", issues: [{ code: recognizer === "recogniseOll" ? "unrecognized-oll" : "unrecognized-pll" }] });
  });
});


it("trusts earlier complete CFOP despite a late accidental full-F2L face", () => {
  const moves = timed(`${f2l} ${oll} ${pll}`);
  const laterIdx = moves.map((_, i) => {
    const state = start.applyAlg(moves.slice(0, i + 1).map(m => m.move).join(" ")).patternData;
    return slots.EDGES_OF_FACE.B.every(e => state.EDGES.pieces[e] === e && state.EDGES.orientation[e] === 0)
      && slots.f2lSlotsForCrossFace("B").every(s => state.EDGES.pieces[s.edge] === s.edge && state.EDGES.orientation[s.edge] === 0 && state.CORNERS.pieces[s.corner] === s.corner && state.CORNERS.orientation[s.corner] === 0);
  }).findIndex(Boolean) + 1;
  expect(laterIdx).toBeGreaterThan(23);
  expect(laterIdx).toBeLessThan(moves.length);
  const analysis = analyseSolve(start, moves)!;
  expect(analysis.crossFace).toBe("D");
  expect(analysis.steps[4].toMove).toBe(16);
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});
it("uses gyro evidence to resolve competing candidates and preserves conflict provenance", () => {
  const alg = "R2 F2 R2 F2", moves = timed(alg);
  const scrambled = puzzle.defaultPattern().applyAlg(new Alg(alg).invert());
  expect(isTrustedCfopAnalysis(analyseSolve(scrambled, moves, null, { trackedBottomFace: "D" }))).toBe(true);
  const conflict = analyseSolve(puzzle.defaultPattern().applyAlg("R'"), timed("R"), null, { trackedBottomFace: "D" })!;
  expect(conflict.quality).toEqual({ status: "suspect", issues: [{ code: "cross-face-conflict", observed: "D", inferred: "L", source: "whole-solve-gyro" }] });
  const disagreement = analyseSolve(scrambled, moves, null, { observedStartBottomFace: "U", trackedBottomFace: "D" })!;
  expect(disagreement.quality!.issues).toContainEqual({ code: "bottom-evidence-conflict", observedStart: "U", tracked: "D" });
  expect(disagreement.quality!.issues).toContainEqual({ code: "ambiguous-cross", candidates: ["U", "D"] });
  expect(isTrustedCfopAnalysis(disagreement)).toBe(false);
  expect(isTrustedCfopAnalysis(analyseSolve(scrambled, moves, null, { observedStartBottomFace: "D", trackedBottomFace: "D" }))).toBe(true);
});
it("quarantines globally collapsed interpretation without a move or time threshold", () => {
  const alg = "R U F", moves = timed(alg);
  const analysis = analyseSolve(puzzle.defaultPattern().applyAlg(new Alg(alg).invert()), moves)!;
  expect(analysis.steps.slice(0, 6).every(step => step.toMove === 2)).toBe(true);
  expect(analysis.quality!.issues).toContainEqual({ code: "incoherent-cfop-progression" });
  expect(isTrustedCfopAnalysis(analysis)).toBe(false);
});
it.each([1, 2])("accepts %s initial XCross pairs", count => {
  const extractions = extracts.slice(count);
  const scrambled = puzzle.defaultPattern().applyAlg(new Alg(pll).invert()).applyAlg(new Alg(oll).invert()).applyAlg(extractions.join(" "));
  const solution = [...extractions].reverse().map(a => new Alg(a).invert().toString()).join(" ") + ` ${oll} ${pll}`;
  const analysis = analyseSolve(scrambled, timed(solution), null, { observedStartBottomFace: "D" })!;
  expect(analysis.steps.slice(1, count + 1).every(step => step.skipped && step.toMove === 0)).toBe(true);
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});
it.each(["OLL", "PLL"])("accepts legitimate %s skips", skipped => {
  const lastLayer = skipped === "OLL" ? pll : oll;
  const scrambled = puzzle.defaultPattern().applyAlg(new Alg(lastLayer).invert()).applyAlg(extracts.join(" "));
  const analysis = analyseSolve(scrambled, timed(`${f2l} ${lastLayer}`), null, { observedStartBottomFace: "D" })!;
  expect(analysis.steps.find(step => step.name === skipped)).toMatchObject({ skipped: true, case: "Solved" });
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});
it("accepts inefficient turning and rotations without treating solve quality as interpretation quality", () => {
  const moves = timed(`${"R R' ".repeat(45)} x x' ${f2l} ${oll} ${pll}`);
  const analysis = analyseSolve(start, moves, null, { observedStartBottomFace: "D" })!;
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});


it.each(["observedStartBottomFace", "trackedBottomFace"] as const)("quarantines %s agreeing with a late accidental interpretation", source => {
  const analysis = analyseSolve(start, timed(`${f2l} ${oll} ${pll}`), null, { [source]: "B" })!;
  expect(analysis.crossFace).toBe("D");
  expect(analysis.quality).toEqual({ status: "suspect", issues: [{ code: "cross-face-conflict", observed: "B", inferred: "D", source: source === "observedStartBottomFace" ? "solve-start" : "whole-solve-gyro" }] });
});
it.each([true, false])("accepts a Cross with four prepared pairs, including OLL skip %s", skipOll => {
  const h = "R2 D2 R D2 R2 D2 R2 D2 R D2 R2";
  const ll = skipOll ? pll : `${oll} ${pll}`;
  const scrambled = puzzle.defaultPattern().applyAlg(new Alg(ll).invert()).applyAlg(new Alg(h).invert());
  const analysis = analyseSolve(scrambled, timed(`${h} ${ll}`), null, { observedStartBottomFace: "D" })!;
  expect(analysis.steps.slice(1, 5).every(step => step.skipped && step.toMove === analysis.steps[0].toMove)).toBe(true);
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});


it("waits for previously identified pair identities to be restored before advancing", () => {
  const inverse = (alg: string) => new Alg(alg).invert().toString();
  const prefix = `${inverse(extracts[3])} ${extracts[3]} U R U' R' U B U' B' U L U' L' R U R' U'`;
  const solution = `${prefix} ${inverse(prefix)} ${f2l} ${oll} ${pll}`;
  const moves = timed(solution);
  const analysis = analyseSolve(start, moves, null, { observedStartBottomFace: "D" })!;
  expect(analysis.steps[1]).toMatchObject({ slot: "FR", toMove: 4 });
  const slotDefinitions = slots.f2lSlotsForCrossFace("D");
  const first = slotDefinitions.find(slot => slot.name === analysis.steps[1].slot)!;
  const witnesses = moves.slice(0, 32).flatMap((_, index) => {
    const state = start.applyAlg(moves.slice(0, index + 1).map(m => m.move).join(" ")).patternData;
    const solved = (slot: typeof first) => state.EDGES.pieces[slot.edge] === slot.edge && state.EDGES.orientation[slot.edge] === 0 && state.CORNERS.pieces[slot.corner] === slot.corner && state.CORNERS.orientation[slot.corner] === 0;
    return !solved(first) && slots.EDGES_OF_FACE.D.every(e => state.EDGES.pieces[e] === e && state.EDGES.orientation[e] === 0) && slotDefinitions.filter(solved).length >= 2 ? [index + 1] : [];
  });
  expect(witnesses).toContain(24);
  const completed: typeof slotDefinitions = [];
  for (const step of analysis.steps.slice(1, 5)) {
    completed.push(slotDefinitions.find(slot => slot.name === step.slot)!);
    const state = start.applyAlg(moves.slice(0, step.toMove).map(m => m.move).join(" ")).patternData;
    for (const slot of completed) {
      expect(state.EDGES.pieces[slot.edge]).toBe(slot.edge);
      expect(state.EDGES.orientation[slot.edge]).toBe(0);
      expect(state.CORNERS.pieces[slot.corner]).toBe(slot.corner);
      expect(state.CORNERS.orientation[slot.corner]).toBe(0);
    }
    expect(witnesses).not.toContain(step.toMove);
  }
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});


it("dominates an alternative using intermediate pair identities even when major checkpoints tie", () => {
  const scrambled = puzzle.defaultPattern().applyAlg("F2 R U R' U R U2 R' F2 U2 F2");
  const moves = timed("D2 B2 B2' D2' F2' U2' F2' R U2' R' U' R U' R' F2'");
  // D and L both reach Cross at 5 and full F2L/OLL at 15. Both have
  // zero distinct intermediate checkpoints after Cross, but D completes
  // its second actual pair at 5 while L cannot do so until 15.
  const atCross = scrambled.applyAlg(moves.slice(0, 5).map(m => m.move).join(" ")).patternData;
  const solvedSlots = (face: slots.Face) => slots.f2lSlotsForCrossFace(face).filter(slot =>
    atCross.EDGES.pieces[slot.edge] === slot.edge && atCross.EDGES.orientation[slot.edge] === 0
    && atCross.CORNERS.pieces[slot.corner] === slot.corner && atCross.CORNERS.orientation[slot.corner] === 0).length;
  expect(solvedSlots("D")).toBe(2);
  expect(solvedSlots("L")).toBe(1);
  const analysis = analyseSolve(scrambled, moves)!;
  expect(analysis.crossFace).toBe("D");
  expect(analysis.steps.map(step => step.toMove)).toEqual([5, 5, 5, 15, 15, 15, 15]);
  expect(isTrustedCfopAnalysis(analysis)).toBe(true);
});
