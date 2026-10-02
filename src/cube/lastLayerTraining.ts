import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { isSolvedPattern, type SolveStep } from "./analysis";
import { isF2lSolved } from "./algBank";
import { OLL_TRAINING_CASES, PLL_TRAINING_CASES } from "./algBank.generated";
import { decodeGripTrack } from "./gripTrack";
import { lastLayerCornersOriented, lastLayerCornersPermuted, lastLayerEdges, reframe, withCentresHome } from "./recognise";
import { rotationForCrossFace, rotationTokensBetween, IDENTITY } from "./orientation";
import type { Face } from "./moves";
import { reconstructTrainingStepStart, standardTrainingRotation, algorithmStm, type TrainingSolveInput } from "./training";
import { joinMoves } from "./notation";
import { ollGroupForCase, pllGroupForCase } from "./lastLayerCases";
import { TWO_LOOK_CASES } from "./lastLayerTwoLookCases";

export type LastLayerFamily = "oll" | "pll";
export type LastLayerTrainingSet = "full" | "2look";
export type LastLayerCompletionGoal = "orient-edges" | "orient-last-layer" | "permute-corners" | "solve-cube";
export type LastLayerAuf = 0 | 1 | 2 | 3;

export type LastLayerTrainingOrigin =
  | { kind: "catalog"; caseId: string }
  | { kind: "solve-step"; solveId: string; stepName: "OLL" | "PLL" };

export type LastLayerReference = {
  rank: number;
  alg: string;
  stm: number;
  auf: LastLayerAuf;
  caseId: string;
  group: string;
};

export type LastLayerTrainingTargetInfo = {
  family: LastLayerFamily;
  trainingSet: LastLayerTrainingSet;
  completionGoal: LastLayerCompletionGoal;
  caseId: string;
  group: string;
  trainingRotation: ReturnType<typeof standardTrainingRotation>;
  references: LastLayerReference[];
  auf: LastLayerAuf;
  origin: LastLayerTrainingOrigin;
};

export type LastLayerTrainingTarget = {
  info: LastLayerTrainingTargetInfo;
  pattern: KPattern;
};

const AUF = ["", "U", "U2", "U'"] as const;
const UNDO_AUF = ["", "U'", "U2", "U"] as const;

type GeneratedCase = { id: string; group: string; setup: string; algorithms: readonly string[] };

export type LastLayerCatalogueCase = GeneratedCase & {
  caseId: string;
  name: string;
  completionGoal: LastLayerCompletionGoal;
};

function catalogueCase(family: LastLayerFamily, caseId: string, trainingSet: LastLayerTrainingSet): LastLayerCatalogueCase {
  if (trainingSet === "full") {
    const source = generatedCase(family, caseId);
    return { ...source, caseId, name: caseId, group: groupFor(family, caseId), completionGoal: family === "oll" ? "orient-last-layer" : "solve-cube" };
  }
  const source = TWO_LOOK_CASES[family].find((item) => item.id === caseId);
  if (!source) throw new Error(`Unknown 2-Look ${family.toUpperCase()} case ${caseId}`);
  // First looks deliberately leave a second look behind. Applying the reference
  // reaches this Sune/Ua base rather than finishing the entire last layer.
  const downstreamId = source.completionGoal === "orient-edges" ? "Sune"
    : source.completionGoal === "permute-corners" ? "Ua" : null;
  const downstream = downstreamId ? TWO_LOOK_CASES[family].find((item) => item.id === downstreamId)! : null;
  const base = new Alg(downstream?.algorithm ?? "").invert();
  return {
    id: source.id, caseId, name: source.id, group: source.group,
    setup: base.concat(new Alg(source.algorithm).invert()).toString(),
    algorithms: [source.algorithm], completionGoal: source.completionGoal,
  };
}

function generatedCase(family: LastLayerFamily, caseId: string): GeneratedCase {
  const found = family === "oll"
    ? OLL_TRAINING_CASES[caseId as keyof typeof OLL_TRAINING_CASES]
    : PLL_TRAINING_CASES[caseId as keyof typeof PLL_TRAINING_CASES];
  if (!found) throw new Error(`Unknown ${family.toUpperCase()} case ${caseId}`);
  return found;
}

function groupFor(family: LastLayerFamily, caseId: string): string {
  return family === "oll"
    ? ollGroupForCase(caseId) ?? generatedCase(family, caseId).group
    : pllGroupForCase(caseId) ?? generatedCase(family, caseId).group;
}

function targetIsComplete(
  completionGoal: LastLayerCompletionGoal,
  pattern: KPattern,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
): boolean {
  const checked = withCentresHome(
    pattern.kpuzzle,
    reframe(pattern.kpuzzle, pattern, new Alg(trainingRotation.tokens.join(" "))),
  );
  if (!isF2lSolved(checked)) return false;
  switch (completionGoal) {
    case "orient-edges": return lastLayerEdges(checked) === "cross";
    case "orient-last-layer": return lastLayerEdges(checked) === "cross" && lastLayerCornersOriented(checked);
    case "permute-corners": return lastLayerEdges(checked) === "cross" && lastLayerCornersOriented(checked) && lastLayerCornersPermuted(checked);
    case "solve-cube": return isSolvedPattern(checked);
  }
}

export function isLastLayerTrainingComplete(
  target: Pick<LastLayerTrainingTargetInfo, "completionGoal" | "trainingRotation">,
  pattern: KPattern,
): boolean {
  return targetIsComplete(target.completionGoal, pattern, target.trainingRotation);
}

function alignedAlgorithm(algorithm: string, auf: LastLayerAuf): string {
  return joinMoves([UNDO_AUF[auf], algorithm].filter(Boolean)).join(" ");
}

function referenceSolvesTarget(
  kpuzzle: KPuzzle,
  targetPattern: KPattern,
  completionGoal: LastLayerCompletionGoal,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
  algorithm: string,
): boolean {
  const rotation = new Alg(trainingRotation.tokens.join(" "));
  const handTarget = reframe(kpuzzle, targetPattern, rotation);
  const solved = reframe(kpuzzle, handTarget.applyAlg(new Alg(algorithm)), rotation.invert());
  return targetIsComplete(completionGoal, solved, trainingRotation);
}

function buildReferences(
  kpuzzle: KPuzzle,
  family: LastLayerFamily,
  caseId: string,
  targetPattern: KPattern,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
  preferredAuf?: LastLayerAuf,
  trainingSet: LastLayerTrainingSet = "full",
): LastLayerReference[] {
  const source = catalogueCase(family, caseId, trainingSet);
  const group = source.group;
  const references: LastLayerReference[] = [];
  for (const algorithm of source.algorithms) {
    const candidates = preferredAuf === undefined
      ? ([0, 1, 2, 3] as LastLayerAuf[])
      : [preferredAuf];
    const aligned = candidates
      .map((auf) => ({ auf, alg: alignedAlgorithm(algorithm, auf) }))
      .find(({ alg }) => referenceSolvesTarget(kpuzzle, targetPattern, source.completionGoal, trainingRotation, alg));
    if (!aligned) continue;
    references.push({
      rank: references.length + 1,
      alg: aligned.alg,
      stm: algorithmStm(aligned.alg),
      auf: aligned.auf,
      caseId,
      group,
    });
  }
  return references;
}

function targetInfo(
  family: LastLayerFamily,
  caseId: string,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
  references: LastLayerReference[],
  auf: LastLayerAuf,
  origin: LastLayerTrainingOrigin,
  trainingSet: LastLayerTrainingSet = "full",
): LastLayerTrainingTargetInfo {
  const source = catalogueCase(family, caseId, trainingSet);
  return { family, trainingSet, completionGoal: source.completionGoal, caseId, group: source.group, trainingRotation, references, auf, origin };
}

export function buildLastLayerCatalogueTarget(
  kpuzzle: KPuzzle,
  family: LastLayerFamily,
  caseId: string,
  auf: LastLayerAuf = 0,
  trainingSet: LastLayerTrainingSet = "full",
): LastLayerTrainingTarget {
  const source = catalogueCase(family, caseId, trainingSet);
  const trainingRotation = standardTrainingRotation();
  const rotation = new Alg(trainingRotation.tokens.join(" "));
  const handTarget = reframe(
    kpuzzle,
    reframe(kpuzzle, kpuzzle.defaultPattern(), rotation).applyAlg(new Alg(source.setup)).applyAlg(new Alg(AUF[auf])),
    rotation.invert(),
  );
  const pattern = handTarget;
  const references = buildReferences(kpuzzle, family, caseId, pattern, trainingRotation, auf, trainingSet);
  if (!references.length) throw new Error(`No reference solves the exact ${family.toUpperCase()} ${caseId} target.`);
  if (targetIsComplete(source.completionGoal, pattern, trainingRotation)) throw new Error(`The ${family.toUpperCase()} ${caseId} target is already complete.`);
  return {
    pattern,
    info: targetInfo(family, caseId, trainingRotation, references, auf, { kind: "catalog", caseId }, trainingSet),
  };
}

function exactTrainingRotation(
  solve: Pick<TrainingSolveInput, "gripTrack">,
  step: Pick<SolveStep, "fromMove">,
  crossFace: Face,
): ReturnType<typeof standardTrainingRotation> {
  const fallback = rotationForCrossFace(crossFace);
  if (!solve.gripTrack) return fallback;
  const track = decodeGripTrack(solve.gripTrack);
  const orientation = track?.orientations[step.fromMove === 0 ? 0 : step.fromMove - 1];
  if (!orientation) return fallback;
  return { tokens: rotationTokensBetween(IDENTITY, orientation), orientation };
}

/** Build the exact last-layer state at a historical OLL/PLL boundary. */
export function buildExactLastLayerTarget(
  kpuzzle: KPuzzle,
  solve: TrainingSolveInput,
  step: SolveStep,
): LastLayerTrainingTarget {
  const family: LastLayerFamily = step.name === "OLL" ? "oll" : "pll";
  if ((step.name !== "OLL" && step.name !== "PLL") || step.skipped || !step.case || step.toMove <= step.fromMove) {
    throw new Error("This solve step cannot be practised as last-layer training");
  }
  const crossFace = solve.analysis?.crossFace;
  if (!crossFace) throw new Error("Last-layer step has no cross face");
  const pattern = reconstructTrainingStepStart(kpuzzle, solve, step.fromMove);
  const trainingRotation = exactTrainingRotation(solve, step, crossFace);
  const caseId = step.case;
  const references = buildReferences(kpuzzle, family, caseId, pattern, trainingRotation);
  if (!references.length) throw new Error(`No reference solves the exact ${family.toUpperCase()} ${caseId} target.`);
  return {
    pattern,
    info: targetInfo(family, caseId, trainingRotation, references, references[0]?.auf ?? 0, {
      kind: "solve-step",
      solveId: solve.id,
      stepName: step.name,
    }),
  };
}

export function lastLayerCaseIds(family: LastLayerFamily, trainingSet: LastLayerTrainingSet = "full"): string[] {
  if (trainingSet === "2look") return TWO_LOOK_CASES[family].map((item) => item.id);
  return Object.keys(family === "oll" ? OLL_TRAINING_CASES : PLL_TRAINING_CASES);
}

export function lastLayerCaseCatalogue(family: LastLayerFamily, trainingSet: LastLayerTrainingSet = "full"): LastLayerCatalogueCase[] {
  return lastLayerCaseIds(family, trainingSet).map((caseId) => catalogueCase(family, caseId, trainingSet));
}

export function lastLayerCaseName(family: LastLayerFamily, caseId: string, trainingSet: LastLayerTrainingSet = "full"): string {
  return `${trainingSet === "2look" ? "2-Look " : ""}${family.toUpperCase()} ${caseId}`;
}
