import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { type SolveStep } from "./analysis";
import {
  F2L_POSITIONS,
  recognizeF2lSlot,
  splitLeadingRotation,
} from "./f2l";
import {
  F2L_CASES,
  positionF2lAlgorithm,
  type F2lCase,
  type F2lPosition,
} from "./f2lCases";
import { f2lTrainingCaseInput, type F2lTrainingCase, type F2lTrainingLibrary } from "./f2lTrainingCases";
import { decodeGripTrack } from "./gripTrack";
import {
  EDGES_OF_FACE,
  f2lSlotsForCrossFace,
  type Face,
} from "./moves";
import {
  joinMoves,
  isRotation,
  parseMove,
} from "./notation";
import {
  IDENTITY,
  rotationForCrossFace,
  rotationForGrip,
  rotationTokensBetween,
  slotInCubeFrame,
  type Orientation,
  type Rotation,
} from "./orientation";
import { parseFaceMove } from "./moves";
import { reframe, withCentresHome } from "./recognise";
import { cubeAlgorithm, cubeMove, cubeMoves, handAlgorithm, handMove, handMoves, handTimedMoves } from "./frames";
import { algorithmStm, buildTrainingGuide, normalizeTrainingReferenceAlgorithm, calculateTrainingEfficiency, referenceExecutionSignature, reconstructTrainingStepStart, type TrainingSolveInput, type TrainingEfficiency, type TrainingResolvedReference, type TrainingAuf, TRAINING_AUF_TOKENS, TRAINING_UNDO_AUF_TOKENS } from "./training";

export {
  algorithmStm,
  calculateTrainingEfficiency,
  referenceExecutionSignature,
  reconstructTrainingStepStart as reconstructF2lStepStart,
};
export type { TrainingEfficiency };
export type F2lTrainingSolveInput = TrainingSolveInput;

export type F2lTrainingOrigin =
  | { kind: "catalog"; library: F2lTrainingLibrary; caseName: string; group: string }
  | { kind: "solve-step"; solveId: string; stepName: string; slot: string };

export type F2lReference = {
  rank: number;
  sourceAlg: string;
  alg: string;
  stm: number;
  caseName: string;
  group: string;
  position: F2lPosition;
};

export type F2lTrainingTargetInfo = {
  family: "f2l";
  origin: F2lTrainingOrigin;
  /** Concrete catalogue variation in the Training/held frame, never durable identity. */
  auf?: TrainingAuf;
  crossFace: Face;
  /** The single cube frame used for display, notation, and reference planning. */
  trainingRotation: Rotation;
  /** The pair's position in the current training grip. */
  position: F2lPosition;
  slot: string;
  protectedSlots: string[];
  references: F2lReference[];
};

export type F2lTrainingGoal = {
  crossFace: Face;
  targetSlot: string;
  protectedSlots: string[];
};

export type F2lTrainingTarget = {
  info: F2lTrainingTargetInfo;
  goal: F2lTrainingGoal;
  pattern: KPattern;
};

export type F2lCatalogueCaseState = {
  pattern: KPattern;
  trainingRotation: Rotation;
  slot: string;
};

type F2lTrainingFrame = Pick<F2lTrainingTargetInfo, "trainingRotation">;

/** The explicit solver grip for both training libraries: white down, green front. */
export function standardF2lTrainingRotation(): Rotation {
  const rotation = rotationForGrip("U", "F");
  if (!rotation) throw new Error("The standard F2L grip is not a valid cube orientation");
  return rotation;
}

/** Resolve the one notation/display frame used by an F2L target. */
export function f2lTrainingRotation(target: F2lTrainingFrame): Rotation {
  return target.trainingRotation;
}

export function f2lTrainingGrip(target: F2lTrainingFrame): Orientation {
  return f2lTrainingRotation(target).orientation;
}

/** Generic training-frame mechanics are shared by F2L and last-layer training. */
export const f2lHandMove = handMove;
export const f2lCubeMove = cubeMove;
export const f2lHandMoves = handMoves;
export const f2lCubeMoves = cubeMoves;
export const f2lHandAlgorithm = handAlgorithm;
export const f2lCubeAlgorithm = cubeAlgorithm;
export const f2lHandTimedMoves = handTimedMoves;

/** Whether a catalogue setup can be sent to a smart cube as outer face turns. */
export function isF2lSetupTrackable(algorithm: string): boolean {
  return Array.from(new Alg(algorithm).expand().childAlgNodes()).every(
    (node) => parseFaceMove(node.toString()) !== null,
  );
}

/** Re-express a canonical setup for another positional slot without showing a y turn. */
export function f2lPositionSetup(
  algorithm: string,
  position: F2lPosition,
): string | null {
  if (!isF2lSetupTrackable(algorithm)) return null;
  const positioned = positionF2lAlgorithm(new Alg(algorithm), "FR", position);
  const signature = referenceExecutionSignature(positioned.toString());
  return signature?.join(" ") ?? null;
}

function slotSolved(pattern: KPattern, slot: { corner: number; edge: number }): boolean {
  const { CORNERS, EDGES } = pattern.patternData;
  return (
    CORNERS.pieces[slot.corner] === slot.corner &&
    CORNERS.orientation[slot.corner] === 0 &&
    EDGES.pieces[slot.edge] === slot.edge &&
    EDGES.orientation[slot.edge] === 0
  );
}

export function crossSolved(pattern: KPattern, crossFace: Face): boolean {
  const edges = pattern.patternData.EDGES;
  return EDGES_OF_FACE[crossFace].every(
    (edge) => edges.pieces[edge] === edge && edges.orientation[edge] === 0,
  );
}

/** A standard white-cross/F2L-complete base, regardless of the last-layer state. */
export function isStandardF2lBase(pattern: KPattern): boolean {
  return (
    crossSolved(pattern, "U") &&
    f2lSlotsForCrossFace("U").every((slot) => slotSolved(pattern, slot))
  );
}

const UNDO_AUF = TRAINING_UNDO_AUF_TOKENS;

function alignedReferenceAlgorithm(algorithm: string, auf: number): string {
  const split = splitLeadingRotation(algorithm);
  return joinMoves(
    split.rotation,
    UNDO_AUF[auf] ? [UNDO_AUF[auf]] : [],
    split.body,
  ).join(" ");
}

type ReferenceValidationOptions = {
  kpuzzle: KPuzzle;
  targetPattern: KPattern;
  trainingRotation: Rotation;
  goal: F2lTrainingGoal;
  algorithm: string;
};

export function referenceSolvesTarget({
  kpuzzle,
  targetPattern,
  trainingRotation,
  goal,
  algorithm,
}: ReferenceValidationOptions): boolean {
  const rotationAlg = new Alg(trainingRotation.tokens.join(" "));
  const handTarget = reframe(kpuzzle, targetPattern, rotationAlg);
  const solved = reframe(
    kpuzzle,
    handTarget.applyAlg(new Alg(algorithm)),
    rotationAlg.invert(),
  );
  return isF2lTrainingComplete({ goal }, solved);
}

export type BuildF2lReferencesOptions = {
  kpuzzle: KPuzzle;
  f2lCase: Pick<F2lCase, "name" | "group">;
  algorithms: readonly string[];
  position: F2lPosition;
  auf: number;
  targetPattern: KPattern;
  trainingRotation: Rotation;
  goal: F2lTrainingGoal;
};

/** Build and validate the ordered references for one recognized case occurrence. */
export function buildF2lReferences({
  kpuzzle,
  f2lCase,
  algorithms,
  position,
  auf,
  targetPattern,
  trainingRotation,
  goal,
}: BuildF2lReferencesOptions): F2lReference[] {
  const references: F2lReference[] = [];
  for (const algorithm of algorithms) {
    const alg = alignedReferenceAlgorithm(algorithm, auf);
    if (!referenceSolvesTarget({
      kpuzzle,
      targetPattern,
      trainingRotation,
      goal,
      algorithm: alg,
    })) continue;
    references.push({
      rank: references.length + 1,
      sourceAlg: algorithm,
      alg,
      stm: algorithmStm(alg),
      caseName: f2lCase.name,
      group: f2lCase.group,
      position,
    });
  }
  return references;
}

/** Reuse the canonical alignment and exact F2L protected-slot completion rules. */
export function resolveF2lTrainingReference(target: F2lTrainingTarget, sourceAlgorithm: string): TrainingResolvedReference | null {
  try {
    const sourceAlg = normalizeTrainingReferenceAlgorithm(sourceAlgorithm);
    if (!sourceAlg) return null;
    for (const auf of [0, 1, 2, 3]) {
      const alg = alignedReferenceAlgorithm(sourceAlg, auf);
      if (!referenceSolvesTarget({ kpuzzle: target.pattern.kpuzzle, targetPattern: target.pattern,
        trainingRotation: target.info.trainingRotation, goal: target.goal, algorithm: alg })) continue;
      const reference = { sourceAlg, alg, stm: algorithmStm(alg) };
      if (buildTrainingGuide(target.pattern, { ...target.info, references: [reference] })) return reference;
    }
  } catch { /* Invalid/unsupported input is not an available reference. */ }
  return null;
}

function goalFor(pattern: KPattern, crossFace: Face, targetSlot: string): F2lTrainingGoal {
  const slots = f2lSlotsForCrossFace(crossFace);
  const target = slots.find((slot) => slot.name === targetSlot);
  if (!target) throw new Error(`Unknown F2L slot ${targetSlot} for cross ${crossFace}`);
  return {
    crossFace,
    targetSlot,
    protectedSlots: slots
      .filter((slot) => slot.name !== targetSlot && slotSolved(pattern, slot))
      .map((slot) => slot.name),
  };
}

/** Fixed-hand setup shared by targets, thumbnails and direct smart-cube setup. */
function catalogueSetup(f2lCase: F2lTrainingCase, position: F2lPosition): Alg {
  return new Alg(f2lTrainingCaseInput(f2lCase, position).setup);
}

export function f2lCatalogueSetupMoves(f2lCase: F2lTrainingCase, position: F2lPosition, auf: TrainingAuf = 0): string | null {
  const setup = catalogueSetup(f2lCase, position).concat(new Alg(TRAINING_AUF_TOKENS[auf]));
  // Reference normalization supports wide/slice turns; setup tracking keeps its
  // existing outer-turn/rotation vocabulary and generic solver fallback.
  if (!Array.from(setup.expand().childAlgNodes()).every((node) => {
    const token = node.toString();
    const parsed = parseMove(token);
    return parseFaceMove(token) !== null || (parsed !== null && isRotation(parsed.family));
  })) return null;
  return referenceExecutionSignature(setup.toString())?.join(" ") ?? null;
}

/** Shared grip/state path positions the canonical case around its intended target. */
export function buildF2lCatalogueCaseState(
  kpuzzle: KPuzzle,
  f2lCase: F2lTrainingCase,
  position: F2lPosition,
  basePattern?: KPattern,
  auf: TrainingAuf = 0,
): F2lCatalogueCaseState {
  const rotation = standardF2lTrainingRotation();
  const rotationAlg = new Alg(rotation.tokens.join(" "));
  const handBase = reframe(
    kpuzzle,
    basePattern ?? kpuzzle.defaultPattern(),
    rotationAlg,
  );
  const positionedSetup = catalogueSetup(f2lCase, position);
  const pattern = reframe(
    kpuzzle,
    handBase.applyAlg(positionedSetup).applyAlg(TRAINING_AUF_TOKENS[auf]),
    rotationAlg.invert(),
  );
  return {
    pattern,
    trainingRotation: rotation,
    slot: slotInCubeFrame(rotation.orientation, position),
  };
}

export function buildF2lCatalogueTarget(
  kpuzzle: KPuzzle,
  f2lCase: F2lTrainingCase,
  positionOrBase: F2lPosition | KPattern = "FR",
  suppliedBase?: KPattern,
  auf: TrainingAuf = 0,
): F2lTrainingTarget {
  const position = typeof positionOrBase === "string" ? positionOrBase : "FR";
  const basePattern = typeof positionOrBase === "string" ? suppliedBase : positionOrBase;
  const crossFace: Face = "U";
  const caseState = buildF2lCatalogueCaseState(
    kpuzzle,
    f2lCase,
    position,
    basePattern,
    auf,
  );
  const { pattern, trainingRotation, slot } = caseState;
  const goal = goalFor(pattern, crossFace, slot);
  const references = buildF2lReferences({
    kpuzzle,
    f2lCase,
    algorithms: f2lTrainingCaseInput(f2lCase, position).algorithms,
    position,
    auf,
    targetPattern: pattern,
    trainingRotation,
    goal,
  });
  return {
    pattern,
    goal,
    info: {
      family: "f2l",
      origin: { kind: "catalog", library: f2lCase.library, caseName: f2lCase.name, group: f2lCase.group },
      auf,
      crossFace,
      trainingRotation,
      position,
      slot,
      protectedSlots: goal.protectedSlots,
      references,
    },
  };
}

function exactStepTrainingRotation(
  solve: Pick<F2lTrainingSolveInput, "gripTrack">,
  step: Pick<SolveStep, "fromMove">,
  crossFace: Face,
): Rotation {
  const fallback = rotationForCrossFace(crossFace);
  if (!solve.gripTrack) return fallback;
  const track = decodeGripTrack(solve.gripTrack);
  if (!track) return fallback;
  const orientation = track.orientations[step.fromMove === 0 ? 0 : step.fromMove - 1];
  if (!orientation) return fallback;
  return {
    tokens: rotationTokensBetween(IDENTITY, orientation),
    orientation,
  };
}

export function buildExactF2lTarget(
  kpuzzle: KPuzzle,
  solve: F2lTrainingSolveInput,
  step: SolveStep,
): F2lTrainingTarget {
  if (
    !step.name.startsWith("F2L") ||
    step.skipped ||
    !step.slot ||
    step.fromMove < 0 ||
    step.toMove <= step.fromMove
  ) {
    throw new Error("This solve step cannot be practised as F2L training");
  }
  const crossFace = solve.analysis?.crossFace;
  if (!crossFace) throw new Error("F2L step has no cross face");

  const pattern = reconstructTrainingStepStart(kpuzzle, solve, step.fromMove);
  const goal = goalFor(pattern, crossFace, step.slot);
  const trainingRotation = exactStepTrainingRotation(solve, step, crossFace);
  const rotationAlg = new Alg(trainingRotation.tokens.join(" "));
  const facing = reframe(kpuzzle, pattern, rotationAlg);
  const position = F2L_POSITIONS.find(
    (candidate) => slotInCubeFrame(trainingRotation.orientation, candidate) === step.slot,
  );
  if (!position) throw new Error(`Unknown F2L position for cube slot ${step.slot}`);

  const recognition = recognizeF2lSlot(kpuzzle, facing, position);
  let references: F2lReference[] = [];
  if (recognition.status === "case" && recognition.match) {
    const f2lCase = F2L_CASES.find(
      (candidate) => candidate.name === recognition.match!.name,
    );
    if (f2lCase) {
      references = buildF2lReferences({
        kpuzzle,
        f2lCase,
        algorithms: f2lCase.algorithms[position],
        position,
        auf: recognition.match.auf,
        targetPattern: pattern,
        trainingRotation,
        goal,
      });
    }
  }

  return {
    pattern,
    goal,
    info: {
      family: "f2l",
      origin: { kind: "solve-step", solveId: solve.id, stepName: step.name, slot: step.slot },
      crossFace,
      trainingRotation,
      position,
      slot: step.slot,
      protectedSlots: goal.protectedSlots,
      references,
    },
  };
}

export function isF2lTrainingComplete(
  target: { goal: F2lTrainingGoal },
  pattern: KPattern,
): boolean {
  const { goal } = target;
  // Reference algorithms may contain a leading `y` that describes turning the cube in
  // the solver's hands. The smart-cube model keeps face turns centre-relative, so the
  // goal is evaluated after removing any equivalent whole-cube rotation as well.
  const checked = withCentresHome(pattern.kpuzzle, pattern);
  const slots = f2lSlotsForCrossFace(goal.crossFace);
  const targetSlot = slots.find((slot) => slot.name === goal.targetSlot);
  if (!targetSlot || !crossSolved(checked, goal.crossFace)) return false;
  if (!slotSolved(checked, targetSlot)) return false;
  return goal.protectedSlots.every((name) => {
    const slot = slots.find((candidate) => candidate.name === name);
    return slot ? slotSolved(checked, slot) : false;
  });
}
