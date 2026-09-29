import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { type SolveStep } from "./analysis";
import { faceletsToPattern } from "./facelets";
import {
  F2L_POSITIONS,
  recognizeF2lSlot,
  splitLeadingRotation,
} from "./f2l";
import {
  F2L_CASES,
  type F2lCase,
  type F2lPosition,
} from "./f2lCases";
import { decodeGripTrack } from "./gripTrack";
import {
  EDGES_OF_FACE,
  f2lSlotsForCrossFace,
  type Face,
} from "./moves";
import {
  countTurns,
  isRotation,
  joinMoves,
  mergeSameFaceTurns,
  parseMove,
  OUTER_FACES,
  type TimedMove,
} from "./notation";
import {
  compose,
  GENERATORS,
  reorientMove,
  invert,
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
import type { Solve } from "../state/types";

export type F2lTrainingOrigin =
  | { kind: "standard"; caseName: string; group: string }
  | { kind: "solve-step"; solveId: string; stepName: string; slot: string };

export type F2lReference = {
  rank: number;
  alg: string;
  stm: number;
  caseName: string;
  group: string;
  position: F2lPosition;
};

export type F2lTrainingTargetInfo = {
  origin: F2lTrainingOrigin;
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

type F2lTrainingFrame = Pick<F2lTrainingTargetInfo, "trainingRotation">;

/** The explicit solver grip for the standard 41-case library: white down, green front. */
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

/** Translate raw centre-relative cube notation into the user's F2L hand frame. */
export function f2lHandMove(move: string, grip: Orientation): string {
  return reorientMove(move, grip);
}

/** Translate solver-hand notation back into the cube's centre-relative coordinates. */
export function f2lCubeMove(move: string, grip: Orientation): string {
  return reorientMove(move, invert(grip));
}

export function f2lHandMoves(
  moves: readonly string[],
  grip: Orientation,
): string[] {
  return moves.map((move) => f2lHandMove(move, grip));
}

export function f2lCubeMoves(
  moves: readonly string[],
  grip: Orientation,
): string[] {
  return moves.map((move) => f2lCubeMove(move, grip));
}

function expandedAlgorithmMoves(algorithm: string): string[] {
  return Array.from(new Alg(algorithm).expand().childAlgNodes()).map((node) =>
    node.toString(),
  );
}

export function f2lHandAlgorithm(algorithm: string, grip: Orientation): string {
  return f2lHandMoves(expandedAlgorithmMoves(algorithm), grip).join(" ");
}

export function f2lCubeAlgorithm(algorithm: string, grip: Orientation): string {
  return f2lCubeMoves(expandedAlgorithmMoves(algorithm), grip).join(" ");
}

function applyRotationToken(orientation: Orientation, token: string): Orientation | null {
  const parsed = parseMove(token);
  if (!parsed || !isRotation(parsed.family)) return null;
  let next = orientation;
  const turns = ((parsed.amount % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    next = compose(next, GENERATORS[parsed.family as keyof typeof GENERATORS]);
  }
  return next;
}

function fixedFrameOuterMove(token: string, orientation: Orientation): string | null {
  const parsed = parseMove(token);
  if (!parsed || !OUTER_FACES.includes(parsed.family as (typeof OUTER_FACES)[number])) {
    return null;
  }
  return reorientMove(token, invert(orientation));
}

/**
 * Convert a reference containing whole-cube rotations into the fixed hand-frame turns
 * a smart cube can report. Wide and slice moves remain intentionally unclassifiable.
 */
export function referenceExecutionSignature(algorithm: string): string[] | null {
  let orientation = IDENTITY;
  const fixedFrameMoves: string[] = [];
  try {
    for (const token of expandedAlgorithmMoves(algorithm)) {
      const parsed = parseMove(token);
      if (!parsed) return null;
      if (isRotation(parsed.family)) {
        const next = applyRotationToken(orientation, token);
        if (!next) return null;
        orientation = next;
        continue;
      }
      const fixedFrameMove = fixedFrameOuterMove(token, orientation);
      if (!fixedFrameMove) return null;
      fixedFrameMoves.push(fixedFrameMove);
    }
  } catch {
    return null;
  }
  return joinMoves(fixedFrameMoves);
}

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
  const positionRotation = positionReframe(position);
  const positioned = positionRotation
    .invert()
    .concat(new Alg(algorithm))
    .concat(positionRotation);
  const signature = referenceExecutionSignature(positioned.toString());
  return signature?.join(" ") ?? null;
}

export function f2lHandTimedMoves(
  moves: readonly TimedMove[],
  grip: Orientation,
): TimedMove[] {
  return moves.map(({ move, t }) => ({ move: f2lHandMove(move, grip), t }));
}

export type TrainingEfficiency = {
  moves: TimedMove[];
  stm: number;
  recommendedStm: number | null;
  matchedReferenceRank: number | null;
  delta: number | null;
  elapsedMs: number;
};

function slotSolved(pattern: KPattern, slot: { corner: number; edge: number }): boolean {
  const { CORNERS, EDGES } = pattern.patternData;
  return (
    CORNERS.pieces[slot.corner] === slot.corner &&
    CORNERS.orientation[slot.corner] === 0 &&
    EDGES.pieces[slot.edge] === slot.edge &&
    EDGES.orientation[slot.edge] === 0
  );
}

function crossSolved(pattern: KPattern, crossFace: Face): boolean {
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

function metricToken(move: string): string {
  // Lower-case wide turns are one deliberate turn for STM, just like an upper-case
  // move a smart cube reports.
  return move.replace(/^[urfdlb]/, (face) => face.toUpperCase());
}

function algorithmStm(alg: string): number {
  const moves = Array.from(new Alg(alg).expand().childAlgNodes()).map((node) =>
    metricToken(node.toString()),
  );
  return countTurns(moves).sliceTurns;
}

const UNDO_AUF = ["", "U'", "U2", "U"];

const POSITION_REFRAMES = ["", "y", "y2", "y'"];

function positionReframe(position: F2lPosition): Alg {
  return new Alg(POSITION_REFRAMES[F2L_POSITIONS.indexOf(position)]);
}

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

function referenceSolvesTarget({
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
  f2lCase: F2lCase;
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
  position,
  auf,
  targetPattern,
  trainingRotation,
  goal,
}: BuildF2lReferencesOptions): F2lReference[] {
  const references: F2lReference[] = [];
  for (const algorithm of f2lCase.algorithms[position]) {
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
      alg,
      stm: algorithmStm(alg),
      caseName: f2lCase.name,
      group: f2lCase.group,
      position,
    });
  }
  return references;
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

export function buildStandardF2lTarget(
  kpuzzle: KPuzzle,
  f2lCase: F2lCase,
  positionOrBase: F2lPosition | KPattern = "FR",
  suppliedBase?: KPattern,
): F2lTrainingTarget {
  const position = typeof positionOrBase === "string" ? positionOrBase : "FR";
  const basePattern = typeof positionOrBase === "string" ? suppliedBase : positionOrBase;
  const crossFace: Face = "U";
  const rotation = standardF2lTrainingRotation();
  const rotationAlg = new Alg(rotation.tokens.join(" "));
  const handBase = reframe(
    kpuzzle,
    basePattern ?? kpuzzle.defaultPattern(),
    rotationAlg,
  );
  // The setup is canonical FR data. Conjugating it by the positional reframe moves
  // the pair without rotating the user's fixed training grip or restoring the LL.
  const positionRotation = positionReframe(position);
  const positionedSetup = positionRotation
    .invert()
    .concat(new Alg(f2lCase.setup))
    .concat(positionRotation);
  const pattern = reframe(
    kpuzzle,
    handBase.applyAlg(positionedSetup),
    rotationAlg.invert(),
  );
  const slot = slotInCubeFrame(rotation.orientation, position);
  const goal = goalFor(pattern, crossFace, slot);
  const references = buildF2lReferences({
    kpuzzle,
    f2lCase,
    position,
    auf: 0,
    targetPattern: pattern,
    trainingRotation: rotation,
    goal,
  });
  return {
    pattern,
    goal,
    info: {
      origin: { kind: "standard", caseName: f2lCase.name, group: f2lCase.group },
      crossFace,
      trainingRotation: rotation,
      position,
      slot,
      protectedSlots: goal.protectedSlots,
      references,
    },
  };
}

function exactStepTrainingRotation(
  solve: Pick<Solve, "gripTrack">,
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

/** Rebuild the cube state immediately before one raw solve move boundary. */
export function reconstructF2lStepStart(
  kpuzzle: KPuzzle,
  solve: Pick<Solve, "scramble" | "scrambledFacelets" | "moves">,
  fromMove: number,
): KPattern {
  const rawMoves = solve.moves ?? [];
  if (!Number.isInteger(fromMove) || fromMove < 0 || fromMove > rawMoves.length) {
    throw new Error(`Invalid F2L step boundary ${fromMove}`);
  }
  let pattern = solve.scrambledFacelets
    ? faceletsToPattern(kpuzzle, solve.scrambledFacelets)
    : kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble));
  for (const { move } of rawMoves.slice(0, fromMove)) pattern = pattern.applyMove(move);
  return pattern;
}

export function buildExactF2lTarget(
  kpuzzle: KPuzzle,
  solve: Solve,
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

  const pattern = reconstructF2lStepStart(kpuzzle, solve, step.fromMove);
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

export function calculateTrainingEfficiency(
  rawMoves: readonly TimedMove[],
  references?: readonly Pick<F2lReference, "stm" | "alg" | "rank">[] |
    Pick<F2lReference, "stm" | "alg"> | null,
): TrainingEfficiency {
  const moves = mergeSameFaceTurns(rawMoves);
  const stm = countTurns(moves.map(({ move }) => metricToken(move))).sliceTurns;
  const referenceList = Array.isArray(references)
    ? references
    : references
      ? [{ ...references, rank: 1 }]
      : [];
  const recommendedStm = referenceList[0]?.stm ?? null;
  const execution = moves.map(({ move }) => move);
  const matchedReferenceRank = referenceList.find((reference) => {
    const signature = referenceExecutionSignature(reference.alg);
    return signature !== null &&
      signature.length === execution.length &&
      signature.every((move, index) => move === execution[index]);
  })?.rank ?? null;
  return {
    moves,
    stm,
    recommendedStm,
    matchedReferenceRank,
    delta: recommendedStm === null ? null : stm - recommendedStm,
    elapsedMs: rawMoves.at(-1)?.t ?? 0,
  };
}

export { algorithmStm };
