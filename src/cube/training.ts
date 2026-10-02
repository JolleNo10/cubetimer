import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { faceletsToPattern } from "./facelets";
import { countTurns, joinMoves, mergeSameFaceTurns, isRotation, parseMove, OUTER_FACES, type TimedMove } from "./notation";
import type { Face } from "./moves";
import {
  compose,
  GENERATORS,
  invert,
  IDENTITY,
  reorientMove,
  rotationForGrip,
  type Orientation,
  type Rotation,
} from "./orientation";

/** The fixed solver frame shared by all 3x3 case-training families. */
export function standardTrainingRotation(): Rotation {
  const rotation = rotationForGrip("U", "F");
  if (!rotation) throw new Error("The standard training grip is not a valid cube orientation");
  return rotation;
}

export function trainingGrip(target: { trainingRotation: Rotation }): Orientation {
  return target.trainingRotation.orientation;
}

export function handMove(move: string, grip: Orientation): string {
  return reorientMove(move, grip);
}

export function cubeMove(move: string, grip: Orientation): string {
  return reorientMove(move, invert(grip));
}

export function handTimedMoves(moves: readonly TimedMove[], grip: Orientation): TimedMove[] {
  return moves.map(({ move, t }) => ({ move: handMove(move, grip), t }));
}

export function expandedAlgorithmMoves(algorithm: string): string[] {
  return Array.from(new Alg(algorithm).expand().childAlgNodes()).map((node) => node.toString());
}

export function handAlgorithm(algorithm: string, grip: Orientation): string {
  return expandedAlgorithmMoves(algorithm).map((move) => handMove(move, grip)).join(" ");
}

export function cubeAlgorithm(algorithm: string, grip: Orientation): string {
  return expandedAlgorithmMoves(algorithm).map((move) => cubeMove(move, grip)).join(" ");
}

export function handMoves(moves: readonly string[], grip: Orientation): string[] {
  return moves.map((move) => handMove(move, grip));
}

export function cubeMoves(moves: readonly string[], grip: Orientation): string[] {
  return moves.map((move) => cubeMove(move, grip));
}

/** Structural historical-solve facts shared by every case-training family. */
export type TrainingSolveInput = {
  id: string;
  scramble: string;
  scrambledFacelets?: string;
  moves: TimedMove[];
  gripTrack?: string;
  analysis?: { crossFace: Face } | null;
};

/** Rebuild the cube state immediately before one recorded move boundary. */
export function reconstructTrainingStepStart(
  kpuzzle: KPuzzle,
  solve: Pick<TrainingSolveInput, "scramble" | "scrambledFacelets" | "moves">,
  fromMove: number,
): KPattern {
  const rawMoves = solve.moves ?? [];
  if (!Number.isInteger(fromMove) || fromMove < 0 || fromMove > rawMoves.length) {
    throw new Error(`Invalid training step boundary ${fromMove}`);
  }
  let pattern = solve.scrambledFacelets
    ? faceletsToPattern(kpuzzle, solve.scrambledFacelets)
    : kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble));
  for (const { move } of rawMoves.slice(0, fromMove)) pattern = pattern.applyMove(move);
  return pattern;
}

function applyRotationToken(orientation: Orientation, token: string): Orientation | null {
  const parsed = parseMove(token);
  if (!parsed || !isRotation(parsed.family)) return null;
  let next = orientation;
  const turns = ((parsed.amount % 4) + 4) % 4;
  for (let index = 0; index < turns; index++) {
    next = compose(next, GENERATORS[parsed.family as keyof typeof GENERATORS]);
  }
  return next;
}

function fixedFrameOuterMove(token: string, orientation: Orientation): string | null {
  const parsed = parseMove(token);
  if (!parsed || !OUTER_FACES.includes(parsed.family as (typeof OUTER_FACES)[number])) return null;
  return reorientMove(token, invert(orientation));
}

/** Convert a reference algorithm to the fixed-frame turns a cube can report. */
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

function metricToken(move: string): string {
  return move.replace(/^[urfdlb]/, (face) => face.toUpperCase());
}

export function algorithmStm(algorithm: string): number {
  const moves = Array.from(new Alg(algorithm).expand().childAlgNodes()).map((node) => metricToken(node.toString()));
  return countTurns(moves).sliceTurns;
}

export type TrainingReferenceLike = { rank?: number; alg: string; stm: number };

export type TrainingEfficiency = {
  moves: TimedMove[];
  stm: number;
  recommendedStm: number | null;
  matchedReferenceRank: number | null;
  delta: number | null;
  elapsedMs: number;
};

export function calculateTrainingEfficiency(
  rawMoves: readonly TimedMove[],
  references?: readonly TrainingReferenceLike[] | TrainingReferenceLike | null,
): TrainingEfficiency {
  const moves = mergeSameFaceTurns(rawMoves);
  const stm = countTurns(moves.map(({ move }) => metricToken(move))).sliceTurns;
  const referenceList = Array.isArray(references)
    ? references.map((reference, index) => ({ ...reference, rank: reference.rank ?? index + 1 }))
    : references
      ? [{ ...references as TrainingReferenceLike, rank: (references as TrainingReferenceLike).rank ?? 1 }]
      : [];
  const recommendedStm = referenceList[0]?.stm ?? null;
  const execution = moves.map(({ move }) => move);
  const matchedReferenceRank = referenceList.find((reference) => {
    const signature = referenceExecutionSignature(reference.alg);
    return signature !== null && signature.length === execution.length && signature.every((move, index) => move === execution[index]);
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
