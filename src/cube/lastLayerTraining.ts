import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { isSolvedPattern, type SolveStep } from "./analysis";
import { isF2lSolved } from "./algBank";
import { OLL_TRAINING_CASES, PLL_TRAINING_CASES } from "./algBank.generated";
import { decodeGripTrack } from "./gripTrack";
import { lastLayerCornersOriented, lastLayerEdges, reframe, withCentresHome } from "./recognise";
import { rotationForCrossFace, rotationTokensBetween, IDENTITY } from "./orientation";
import type { Face } from "./moves";
import { reconstructTrainingStepStart, standardTrainingRotation, algorithmStm, type TrainingSolveInput } from "./training";
import { joinMoves } from "./notation";
import { ollGroupForCase, pllGroupForCase } from "./lastLayerCases";

export type LastLayerFamily = "oll" | "pll";
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
  family: LastLayerFamily,
  pattern: KPattern,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
): boolean {
  const checked = withCentresHome(
    pattern.kpuzzle,
    reframe(pattern.kpuzzle, pattern, new Alg(trainingRotation.tokens.join(" "))),
  );
  if (!isF2lSolved(checked)) return false;
  if (family === "oll") {
    return lastLayerEdges(checked) === "cross" && lastLayerCornersOriented(checked);
  }
  return isSolvedPattern(checked);
}

export function isLastLayerTrainingComplete(
  target: Pick<LastLayerTrainingTargetInfo, "family" | "trainingRotation">,
  pattern: KPattern,
): boolean {
  return targetIsComplete(target.family, pattern, target.trainingRotation);
}

function alignedAlgorithm(algorithm: string, auf: LastLayerAuf): string {
  return joinMoves([UNDO_AUF[auf], algorithm].filter(Boolean)).join(" ");
}

function referenceSolvesTarget(
  kpuzzle: KPuzzle,
  targetPattern: KPattern,
  family: LastLayerFamily,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
  algorithm: string,
): boolean {
  const rotation = new Alg(trainingRotation.tokens.join(" "));
  const handTarget = reframe(kpuzzle, targetPattern, rotation);
  const solved = reframe(kpuzzle, handTarget.applyAlg(new Alg(algorithm)), rotation.invert());
  return targetIsComplete(family, solved, trainingRotation);
}

function buildReferences(
  kpuzzle: KPuzzle,
  family: LastLayerFamily,
  caseId: string,
  targetPattern: KPattern,
  trainingRotation: LastLayerTrainingTargetInfo["trainingRotation"],
  preferredAuf?: LastLayerAuf,
): LastLayerReference[] {
  const source = generatedCase(family, caseId);
  const group = groupFor(family, caseId);
  const references: LastLayerReference[] = [];
  for (const algorithm of source.algorithms) {
    const candidates = preferredAuf === undefined
      ? ([0, 1, 2, 3] as LastLayerAuf[])
      : [preferredAuf];
    const aligned = candidates
      .map((auf) => ({ auf, alg: alignedAlgorithm(algorithm, auf) }))
      .find(({ alg }) => referenceSolvesTarget(kpuzzle, targetPattern, family, trainingRotation, alg));
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
): LastLayerTrainingTargetInfo {
  return { family, caseId, group: groupFor(family, caseId), trainingRotation, references, auf, origin };
}

export function buildLastLayerCatalogueTarget(
  kpuzzle: KPuzzle,
  family: LastLayerFamily,
  caseId: string,
  auf: LastLayerAuf = 0,
): LastLayerTrainingTarget {
  const source = generatedCase(family, caseId);
  const trainingRotation = standardTrainingRotation();
  const rotation = new Alg(trainingRotation.tokens.join(" "));
  const handTarget = reframe(
    kpuzzle,
    reframe(kpuzzle, kpuzzle.defaultPattern(), rotation).applyAlg(new Alg(source.setup)).applyAlg(new Alg(AUF[auf])),
    rotation.invert(),
  );
  const pattern = handTarget;
  const references = buildReferences(kpuzzle, family, caseId, pattern, trainingRotation, auf);
  if (!references.length) throw new Error(`No reference solves the exact ${family.toUpperCase()} ${caseId} target.`);
  if (targetIsComplete(family, pattern, trainingRotation)) throw new Error(`The ${family.toUpperCase()} ${caseId} target is already complete.`);
  return {
    pattern,
    info: targetInfo(family, caseId, trainingRotation, references, auf, { kind: "catalog", caseId }),
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

export function lastLayerCaseIds(family: LastLayerFamily): string[] {
  return Object.keys(family === "oll" ? OLL_TRAINING_CASES : PLL_TRAINING_CASES);
}

export function lastLayerCaseCatalogue(family: LastLayerFamily): GeneratedCase[] {
  return lastLayerCaseIds(family).map((caseId) => generatedCase(family, caseId));
}

export function lastLayerCaseName(family: LastLayerFamily, caseId: string): string {
  return family === "oll" ? `OLL ${caseId}` : `PLL ${caseId}`;
}
