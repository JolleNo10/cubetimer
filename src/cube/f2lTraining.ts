import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { type SolveStep } from "./analysis";
import { faceletsToPattern } from "./facelets";
import { F2L_SLOTS, planF2l } from "./f2l";
import { type F2lCase } from "./f2lCases";
import { decodeGripTrack } from "./gripTrack";
import {
  EDGES_OF_FACE,
  f2lSlotsForCrossFace,
  type Face,
} from "./moves";
import {
  countTurns,
  mergeSameFaceTurns,
  type TimedMove,
} from "./notation";
import {
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
  source: "standard-case";
  alg: string;
  stm: number;
  caseName?: string;
  group?: string;
};

export type F2lTrainingTargetInfo = {
  origin: F2lTrainingOrigin;
  crossFace: Face;
  /** The single cube frame used for display, notation, and reference planning. */
  trainingRotation: Rotation;
  slot: string;
  protectedSlots: string[];
  reference: F2lReference | null;
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

/** Whether a catalogue setup can be sent to a smart cube as outer face turns. */
export function isF2lSetupTrackable(algorithm: string): boolean {
  return Array.from(new Alg(algorithm).expand().childAlgNodes()).every(
    (node) => parseFaceMove(node.toString()) !== null,
  );
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
  referenceStm: number | null;
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
  // SpeedCubeDB uses lower-case wide turns in a few primary algorithms. They are one
  // deliberate turn for STM, just like the upper-case move a smart cube reports.
  return move.replace(/^[urfdlb]/, (face) => face.toUpperCase());
}

function algorithmStm(alg: string): number {
  const moves = Array.from(new Alg(alg).expand().childAlgNodes()).map((node) =>
    metricToken(node.toString()),
  );
  return countTurns(moves).sliceTurns;
}

function referenceForCase(f2lCase: F2lCase): F2lReference {
  return {
    source: "standard-case",
    alg: f2lCase.alg,
    stm: algorithmStm(f2lCase.alg),
    caseName: f2lCase.name,
    group: f2lCase.group,
  };
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
  basePattern?: KPattern,
): F2lTrainingTarget {
  const crossFace: Face = "U";
  const rotation = standardF2lTrainingRotation();
  const rotationAlg = new Alg(rotation.tokens.join(" "));
  const handBase = reframe(
    kpuzzle,
    basePattern ?? kpuzzle.defaultPattern(),
    rotationAlg,
  );
  const pattern = reframe(
    kpuzzle,
    handBase.applyAlg(new Alg(f2lCase.setup)),
    rotationAlg.invert(),
  );
  const slot = slotInCubeFrame(rotation.orientation, F2L_SLOTS[0].name);
  const reference = referenceForCase(f2lCase);
  const goal = goalFor(pattern, crossFace, slot);
  return {
    pattern,
    goal,
    info: {
      origin: { kind: "standard", caseName: f2lCase.name, group: f2lCase.group },
      crossFace,
      trainingRotation: rotation,
      slot,
      protectedSlots: goal.protectedSlots,
      reference,
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
  const handPlan = planF2l(kpuzzle, facing).find(
    (candidate) => slotInCubeFrame(trainingRotation.orientation, candidate.name) === step.slot,
  );

  let reference: F2lReference | null = null;
  if (handPlan?.status === "case" && handPlan.solution) {
    const candidate = reframe(
      kpuzzle,
      facing.applyAlg(new Alg(handPlan.solution.moves.join(" "))),
      rotationAlg.invert(),
    );
    if (isF2lTrainingComplete({ goal }, candidate)) {
      reference = {
        source: "standard-case",
        alg: handPlan.solution.moves.join(" "),
        stm: algorithmStm(handPlan.solution.moves.join(" ")),
        caseName: handPlan.solution.name,
        group: handPlan.solution.group,
      };
    }
  }

  return {
    pattern,
    goal,
    info: {
      origin: { kind: "solve-step", solveId: solve.id, stepName: step.name, slot: step.slot },
      crossFace,
      trainingRotation,
      slot: step.slot,
      protectedSlots: goal.protectedSlots,
      reference,
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
  reference?: Pick<F2lReference, "stm" | "alg"> | null,
): TrainingEfficiency {
  const moves = mergeSameFaceTurns(rawMoves);
  const stm = countTurns(moves.map(({ move }) => metricToken(move))).sliceTurns;
  const referenceStm = reference ? reference.stm ?? algorithmStm(reference.alg) : null;
  return {
    moves,
    stm,
    referenceStm,
    delta: referenceStm === null ? null : stm - referenceStm,
    elapsedMs: rawMoves.at(-1)?.t ?? 0,
  };
}

export { algorithmStm };
