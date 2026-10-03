import { Alg, Move } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { faceletsToPattern } from "./facelets";
import { countTurns, joinMoves, mergeSameFaceTurns, isRotation, parseMove, OUTER_FACES, type TimedMove } from "./notation";
import type { Face } from "./moves";
import {
  compose,
  ALL_ORIENTATIONS,
  GENERATORS,
  invert,
  IDENTITY,
  reorientMove,
  rotationForGrip,
  type Orientation,
  type Rotation,
} from "./orientation";
import { reframe, withCentresHome } from "./recognise";

export type TrainingGuideMove = {
  token: string;
  kind: "outer" | "wide" | "slice" | "rotation";
  axis: "x" | "y" | "z";
  /** A layer interval in the fixed solver-facing cube, from -1 to 1. */
  layers: readonly [number, number];
  /** Right-hand rotation about the positive axis; half turns have no required direction. */
  direction: -1 | 1;
  halfTurn: boolean;
};

const GUIDE_FACES = {
  R: { axis: "x", side: 1 }, L: { axis: "x", side: -1 },
  U: { axis: "y", side: 1 }, D: { axis: "y", side: -1 },
  F: { axis: "z", side: 1 }, B: { axis: "z", side: -1 },
} as const;

type GuideKind = TrainingGuideMove["kind"];
const GUIDE_FAMILIES: Record<string, { face: Face; kind: GuideKind }> = {
  ...Object.fromEntries(OUTER_FACES.flatMap((face) => [
    [face, { face, kind: "outer" }],
    [face.toLowerCase(), { face, kind: "wide" }],
    [`${face}w`, { face, kind: "wide" }],
  ])),
  M: { face: "L", kind: "slice" }, E: { face: "D", kind: "slice" }, S: { face: "F", kind: "slice" },
  x: { face: "R", kind: "rotation" }, y: { face: "U", kind: "rotation" }, z: { face: "F", kind: "rotation" },
};

function guideLayers(kind: GuideKind, side: number): readonly [number, number] {
  if (kind === "rotation") return [-1, 1];
  if (kind === "slice") return [-1 / 3, 1 / 3];
  const inner = kind === "wide" ? -1 / 3 : 1 / 3;
  return side === 1 ? [inner, 1] : [-1, -inner];
}

/** cubing.js owns notation parsing, including wide turns and expanded groups. */
export function trainingGuideMove(token: string, orientation: Orientation = IDENTITY): TrainingGuideMove | null {
  try {
    const move = new Move(token);
    const family = GUIDE_FAMILIES[move.quantum.family];
    const turns = ((move.amount % 4) + 4) % 4;
    if (!turns || !family) return null;
    const { face, kind } = family;
    const { axis, side } = GUIDE_FACES[orientation[face]];
    const layers = guideLayers(kind, side);
    return { token, kind, axis, layers, direction: (turns === 3 ? side : -side) as -1 | 1, halfTurn: turns === 2 };
  } catch {
    return null;
  }
}

export type TrainingGuideProgress = {
  moves: readonly string[];
  confirmed: number;
  currentMove: TrainingGuideMove | null;
  finished: boolean;
};

export type TrainingGuide = {
  moves: readonly string[];
  guideMoves: readonly TrainingGuideMove[];
  checkpointKeys: readonly string[];
  rotation: Alg;
};

function guidePatternKey(pattern: KPattern): string {
  const normalized = withCentresHome(pattern.kpuzzle, pattern);
  // Smart cubes do not report center sticker orientation. Piece state is truth.
  return JSON.stringify([normalized.patternData.CORNERS, normalized.patternData.EDGES]);
}

/** Build once from the exact target, through the same frame as reference validation. */
export function buildTrainingGuide(
  pattern: KPattern,
  target: { trainingRotation: Rotation; references: readonly TrainingReferenceLike[] },
): TrainingGuide | null {
  const reference = target.references[0];
  if (!reference) return null;
  try {
    const moves = Array.from(new Alg(reference.alg).expand().childAlgNodes())
      .filter((node): node is Move => node instanceof Move).map((node) => node.toString());
    if (!moves.length) return null;
    const kpuzzle = pattern.kpuzzle;
    const rotation = new Alg(target.trainingRotation.tokens.join(" "));
    let checkpoint = reframe(kpuzzle, pattern, rotation);
    const checkpointKeys = [guidePatternKey(checkpoint)];
    const guideMoves: TrainingGuideMove[] = [];
    for (const token of moves) {
      // Wide/slice turns and rotations change center locations. Reuse the existing
      // orientation group to express the next arrow in the fixed Training view.
      const centers = checkpoint.patternData.CENTERS.pieces;
      const held = ALL_ORIENTATIONS.find((candidate) => kpuzzle.defaultPattern()
        .applyAlg(new Alg(candidate.tokens.join(" "))).patternData.CENTERS.pieces
        .every((piece, index) => piece === centers[index]));
      if (!held) return null;
      const guideMove = trainingGuideMove(token, invert(held.orientation));
      if (!guideMove) return null;
      guideMoves.push(guideMove);
      checkpoint = checkpoint.applyMove(token);
      checkpointKeys.push(guidePatternKey(checkpoint));
    }
    return { moves, guideMoves, checkpointKeys, rotation };
  } catch {
    // An unavailable/unsupported reference must never prevent an attempt.
    return null;
  }
}

export function trainingGuideProgress(guide: TrainingGuide, confirmed = 0): TrainingGuideProgress {
  return { moves: guide.moves, confirmed, currentMove: guide.guideMoves[confirmed] ?? null, finished: confirmed >= guide.moves.length };
}

/** Monotonic confirmation: deviations retain progress and later checkpoints rejoin. */
export function advanceTrainingGuide(guide: TrainingGuide, pattern: KPattern, confirmed: number): TrainingGuideProgress {
  const facing = reframe(pattern.kpuzzle, pattern, guide.rotation);
  const key = guidePatternKey(facing);
  let next = confirmed;
  for (let index = confirmed + 1; index < guide.checkpointKeys.length; index++) {
    // Keep an intermediate rotation as the next visible instruction. The next
    // piece-changing checkpoint can confirm past it without a gyro event.
    if (guide.guideMoves[index - 1].kind === "rotation" && index < guide.moves.length) continue;
    if (guide.checkpointKeys[index] === key) next = index;
  }
  return trainingGuideProgress(guide, next);
}

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

const REFERENCE_DECOMPOSITIONS: Record<string, string> = {
  r: "x L", Rw: "x L", l: "x' R", Lw: "x' R",
  u: "y D", Uw: "y D", d: "y' U", Dw: "y' U",
  f: "z B", Fw: "z B", b: "z' F", Bw: "z' F",
  M: "x' R L'", E: "y' U D'", S: "z F' B",
};

function observableReferenceMoves(token: string): string[] {
  const move = new Move(token);
  const decomposition = REFERENCE_DECOMPOSITIONS[move.quantum.toString()];
  if (!decomposition) return [token];
  // Each decomposition consists of commuting operations about the same axis,
  // so scaling their amounts handles inverse and double turns as well.
  return Array.from(new Alg(decomposition).childAlgNodes()).map((node) => {
    const operation = node as Move;
    return new Move(operation.quantum, operation.amount * move.amount).toString();
  });
}

/** Convert a reference algorithm to the fixed-frame turns a cube can report. */
export function referenceExecutionSignature(algorithm: string): string[] | null {
  let orientation = IDENTITY;
  const fixedFrameMoves: string[] = [];
  try {
    for (const token of expandedAlgorithmMoves(algorithm).flatMap(observableReferenceMoves)) {
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
  const observedStm = countTurns(moves.map(({ move }) => metricToken(move))).sliceTurns;
  const referenceList = Array.isArray(references)
    ? references.map((reference, index) => ({ ...reference, rank: reference.rank ?? index + 1 }))
    : references
      ? [{ ...references as TrainingReferenceLike, rank: (references as TrainingReferenceLike).rank ?? 1 }]
      : [];
  const recommendedStm = referenceList[0]?.stm ?? null;
  const execution = moves.map(({ move }) => move);
  const matchedReference = referenceList.find((reference) => {
    const signature = referenceExecutionSignature(reference.alg);
    return signature !== null && signature.length === execution.length && signature.every((move, index) => move === execution[index]);
  });
  const stm = matchedReference?.stm ?? observedStm;
  return {
    moves,
    stm,
    recommendedStm,
    matchedReferenceRank: matchedReference?.rank ?? null,
    delta: recommendedStm === null ? null : stm - recommendedStm,
    elapsedMs: rawMoves.at(-1)?.t ?? 0,
  };
}
