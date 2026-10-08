import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { get3x3x3 } from "../../cube/puzzle";
import { patternToFacelets } from "../../cube/facelets";
import { buildStateOnlyCfopAnalysis, rebuildAnalysis } from "./repair";
import { isUsableCfopAnalysis } from "../../app/solveAnalysis";
import { ANALYSIS_VERSION, analyseSolve, isTrustedCfopAnalysis } from "../../cube/analysis";
import type { Solve } from "../../app/types";

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

  it("rebuilds an analysis made by an older version, gaining what it lacked", () => {
    const current = rebuildAnalysis(kpuzzle, solve())!;
    const { analysisVersion: _version, ...older } = current.analysis!;
    const outdated = { ...current, analysis: { ...older, steps: older.steps.map((step) => ({ ...step, case: step.name.startsWith("F2L") ? null : step.case })) } };
    const rebuilt = rebuildAnalysis(kpuzzle, outdated);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.analysis!.analysisVersion).toBe(ANALYSIS_VERSION);
  });

  it("keeps an outdated analysis that cannot be rebuilt", () => {
    const current = rebuildAnalysis(kpuzzle, solve())!;
    const { analysisVersion: _version, ...older } = current.analysis!;
    expect(rebuildAnalysis(kpuzzle, { ...current, moves: [], source: "import", analysis: older })).toBeNull();
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

describe("state-only correction", () => {
  const start = kpuzzle.defaultPattern().applyAlg(scramble);
  const base = analyseSolve(start, moves, null, { observedStartBottomFace: "L", trackedBottomFace: "D" })!;
  it("recovers a trusted interpretation from conflicting bottom evidence using only raw facts", () => {
    const original = solve({ analysis: base, solveStartBottomFace: "L", gripTrack: `|${"LF".repeat(moves.length)}` });
    const candidate = buildStateOnlyCfopAnalysis(kpuzzle, original);
    expect(base.quality?.issues.some(issue => issue.code === "bottom-evidence-conflict")).toBe(true);
    expect(isTrustedCfopAnalysis(base)).toBe(false);
    expect(isTrustedCfopAnalysis(candidate)).toBe(true);
    expect(candidate).toEqual(analyseSolve(start, moves, null, {}));
    expect(original.analysis).toBe(base);
    expect(buildStateOnlyCfopAnalysis(kpuzzle, { ...original, moves: [] })).toBeNull();
    expect(buildStateOnlyCfopAnalysis(kpuzzle, { ...original, scramble: "" })).toBeNull();
    expect(buildStateOnlyCfopAnalysis(kpuzzle, { ...original, moves: [{ move: "invalid", t: 100 }] })).toBeNull();
  });
  it("refreshes only an outdated correction snapshot, preserving its decision and base", () => {
    const candidate = buildStateOnlyCfopAnalysis(kpuzzle, solve())!;
    const original = solve({ analysis: base, cfopAnalysisExcluded: true,
      cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 321, analysis: { ...candidate, analysisVersion: ANALYSIS_VERSION - 1 } } });
    const rebuilt = rebuildAnalysis(kpuzzle, original)!;
    expect(rebuilt.analysis).toBe(base);
    expect(rebuilt.cfopAnalysisCorrection).toEqual({ mode: "state-only", acceptedAt: 321, analysis: candidate });
    expect(rebuilt.cfopAnalysisExcluded).toBe(true);
    expect(rebuildAnalysis(kpuzzle, rebuilt)).toBeNull();
    expect(rebuildAnalysis(kpuzzle, { ...original, moves: [] })).toBeNull();
    expect(original.cfopAnalysisCorrection?.acceptedAt).toBe(321);
  });
  it("keeps a refreshed suspect correction overlaid and unusable", () => {
    const original = solve({ analysis: base, scramble: "F2 R2 F2 R2", moves: ["R2", "F2", "R2", "F2"].map((move, i) => ({ move, t: (i + 1) * 200 })),
      cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 99, analysis: { ...base, analysisVersion: 1 } } });
    const rebuilt = rebuildAnalysis(kpuzzle, original)!;
    expect(rebuilt.analysis).toBe(base);
    expect(rebuilt.cfopAnalysisCorrection?.acceptedAt).toBe(99);
    expect(rebuilt.cfopAnalysisCorrection?.analysis.quality?.status).toBe("suspect");
    expect(isUsableCfopAnalysis(rebuilt)).toBe(false);
  });
  it("repairs both snapshots independently when both are outdated", () => {
    const original = solve({ analysis: { ...base, analysisVersion: 1 }, solveStartBottomFace: "L",
      cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 42, analysis: { ...base, analysisVersion: 1 } } });
    const rebuilt = rebuildAnalysis(kpuzzle, original)!;
    expect(rebuilt.analysis?.analysisVersion).toBe(ANALYSIS_VERSION);
    expect(rebuilt.analysis?.quality?.status).toBe("suspect");
    expect(isTrustedCfopAnalysis(rebuilt.cfopAnalysisCorrection?.analysis)).toBe(true);
    expect(rebuilt.cfopAnalysisCorrection?.acceptedAt).toBe(42);
  });
});


it("rebuilds v2 or missing-quality analysis using the independent observation", () => {
  const current = analyseSolve(kpuzzle.defaultPattern().applyAlg(scramble), moves, null, { observedStartBottomFace: "D" })!;
  for (const version of [2, ANALYSIS_VERSION]) {
    const legacy = { ...current, analysisVersion: version, quality: undefined };
    const rebuilt = rebuildAnalysis(kpuzzle, solve({ analysis: legacy, solveStartBottomFace: "D" }))!;
    expect(rebuilt.analysis).toMatchObject({ analysisVersion: ANALYSIS_VERSION, quality: { status: "trusted", issues: [] } });
    expect(rebuilt.solveStartBottomFace).toBe("D");
  }
});
it("leaves unrebuildable legacy analysis readable but untrusted", () => {
  const current = analyseSolve(kpuzzle.defaultPattern().applyAlg(scramble), moves, null, { observedStartBottomFace: "D" })!;
  const legacy = { ...current, analysisVersion: 2, quality: undefined };
  const original = solve({ analysis: legacy, moves: [], scramble: "invalid" });
  expect(rebuildAnalysis(kpuzzle, original)).toBeNull();
  expect(original.analysis).toBe(legacy);
  expect(isTrustedCfopAnalysis(original.analysis)).toBe(false);
});


it("does not promote historical reconstructed grip into raw bottom evidence", () => {
  const rebuilt = rebuildAnalysis(kpuzzle, solve({ scramble: new Alg("R2 F2 R2 F2").invert().toString(), moves: ["R2", "F2", "R2", "F2"].map((move, i) => ({ move, t: (i + 1) * 200 })), gripTrack: `|${"DF".repeat(4)}` }))!;
  expect(rebuilt.solveStartBottomFace).toBeUndefined();
  expect(isTrustedCfopAnalysis(rebuilt.analysis)).toBe(false);
  expect(rebuilt.analysis!.quality!.issues.some(issue => issue.code === "ambiguous-cross")).toBe(true);
});


it("reclassifies rebuildable v3 quality under the refined current interpretation rules", () => {
  const current = analyseSolve(kpuzzle.defaultPattern().applyAlg(scramble), moves, null, { observedStartBottomFace: "D" })!;
  const old = { ...current, analysisVersion: 3, quality: { status: "suspect" as const, issues: [{ code: "ambiguous-cross" as const, candidates: ["D", "L"] as import("../../cube/moves").Face[] }] } };
  const rebuilt = rebuildAnalysis(kpuzzle, solve({ analysis: old, solveStartBottomFace: "D" }))!;
  expect(rebuilt.analysis).toMatchObject({ analysisVersion: ANALYSIS_VERSION, quality: { status: "trusted", issues: [] } });
});


it("preserves manual exclusion through a version-5 to merged version-6 analysis rebuild", () => {
  const current = analyseSolve(kpuzzle.defaultPattern().applyAlg(scramble),moves,null,{observedStartBottomFace:"D"})!;
  const rebuilt = rebuildAnalysis(kpuzzle,solve({analysis:{...current,analysisVersion:5},cfopAnalysisExcluded:true,solveStartBottomFace:"D"}))!;
  expect(rebuilt.cfopAnalysisExcluded).toBe(true);
  expect(rebuilt.analysis).toMatchObject({analysisVersion:ANALYSIS_VERSION,quality:{status:"trusted",issues:[]}});
});
