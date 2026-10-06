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
const textbook = () => analyseSolve(start, timed(`${f2l} ${oll} ${pll}`), null, "D")!;
afterEach(() => vi.restoreAllMocks());

describe("CFOP quality", () => {
  it("keeps textbook CFOP trusted with explicit current quality", () => {
    const analysis = textbook();
    expect(ANALYSIS_VERSION).toBe(3);
    expect(analysis).toMatchObject({ crossFace: "D", analysisVersion: 3, quality: { status: "trusted", issues: [] } });
    expect(isTrustedCfopAnalysis(analysis)).toBe(true);
    expect(isTrustedCfopAnalysis({ ...analysis, quality: undefined })).toBe(false);
    expect(isTrustedCfopAnalysis({ ...analysis, analysisVersion: 2 })).toBe(false);
  });
  it("uses observed bottom to resolve otherwise ambiguous state progression", () => {
    const moves = timed(oll), scrambled = puzzle.defaultPattern().applyAlg(new Alg(oll).invert());
    expect(analyseSolve(scrambled, moves)!.quality).toMatchObject({ status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["D", "L"] }] });
    expect(isTrustedCfopAnalysis(analyseSolve(scrambled, moves, null, "D"))).toBe(true);
  });
  it("marks an observed-bottom conflict with unique pre-solution state evidence", () => {
    const scrambled = puzzle.defaultPattern().applyAlg("R'");
    expect(isTrustedCfopAnalysis(analyseSolve(scrambled, timed("R")))).toBe(true);
    const analysis = analyseSolve(scrambled, timed("R"), null, "D")!;
    expect(analysis.crossFace).toBe("L");
    expect(analysis.quality).toEqual({ status: "suspect", issues: [{ code: "cross-face-conflict", observed: "D", inferred: "L" }] });
  });
  it("does not infer intended Cross from the final solved state alone", () => {
    const analysis = analyseSolve(puzzle.defaultPattern().applyAlg("M2"), timed("M2"))!;
    expect(analysis.quality).toEqual({ status: "suspect", issues: [{ code: "ambiguous-cross", candidates: [...slots.FACES] }] });
  });
  it("requires restored Cross at F2L checkpoints and keeps shared checkpoints and null cases legitimate", () => {
    const h = "R2 D2 R D2 R2 D2 R2 D2 R D2 R2";
    const witness = start.applyAlg(`${h} ${f2l}`).patternData;
    expect(slots.f2lSlotsForCrossFace("D").every(s => witness.EDGES.pieces[s.edge] === s.edge && witness.CORNERS.pieces[s.corner] === s.corner)).toBe(true);
    expect(slots.EDGES_OF_FACE.D.every(e => witness.EDGES.pieces[e] === e)).toBe(false);
    const moves = timed(`${h} ${f2l} ${new Alg(h).invert()} ${oll} ${pll}`);
    const analysis = analyseSolve(start, moves, null, "D")!;
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
    const analysis = analyseSolve(start, moves, null, "D")!;
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
