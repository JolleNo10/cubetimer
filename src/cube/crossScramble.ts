import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { faceOfColour } from "./colours";
import { CROSS_MOVES, crossSolver } from "./crossSolver";
import { rotationForCrossFace } from "./orientation";
import { get3x3x3 } from "./puzzle";
import { reframe } from "./recognise";
import {
  eventInfo,
  generateScramble,
  type EventId,
} from "./scramble";
import { solveAlg } from "./solver";

export type WhiteCrossMoves = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const WHITE_CROSS_MIN_MOVES = 1;
const WHITE_CROSS_MAX_MOVES = 7;

/** The exact optimal white-cross distance of a pattern in the app's cube frame. */
export function whiteCrossDistance(kpuzzle: KPuzzle, pattern: KPattern): number {
  return crossSolver(kpuzzle).lengthFrom(
    reframe(kpuzzle, pattern, whiteDownRotation()),
  );
}

/**
 * Build a varied target state whose white cross has the requested exact distance.
 *
 * The seed supplies the non-cross variation. The cross is solved in the solver's D
 * frame, then a short path that increases the exact cross distance one step at a time
 * is applied before returning to the app's normal frame.
 */
export function buildWhiteCrossTarget(
  kpuzzle: KPuzzle,
  seedPattern: KPattern,
  requestedMoves: WhiteCrossMoves,
  random: () => number = Math.random,
): KPattern {
  assertWhiteCrossMoves(requestedMoves);

  const rotation = whiteDownRotation();
  const solver = crossSolver(kpuzzle);
  const orientedSeed = reframe(kpuzzle, seedPattern, rotation);
  const crossSolution = solver.solve(orientedSeed);
  const crossSolved = orientedSeed.applyAlg(new Alg(crossSolution.join(" ")));
  const setup = findExactCrossSetup(kpuzzle, solver, requestedMoves, random);
  const orientedTarget = crossSolved.applyAlg(new Alg(setup.join(" ")));

  return reframe(kpuzzle, orientedTarget, rotation.invert());
}

/** Generate a normal short 3x3 scramble with an exact white-cross distance. */
export async function generateWhiteCrossScramble(
  event: EventId,
  requestedMoves: WhiteCrossMoves,
  random: () => number = Math.random,
): Promise<string> {
  assertWhiteCrossMoves(requestedMoves);
  if (eventInfo(event).puzzle !== "3x3x3") {
    throw new Error("White-cross scrambles require a 3x3 event");
  }

  const kpuzzle = await get3x3x3();
  const seedScramble = await generateScramble(event);
  const seedPattern = kpuzzle.defaultPattern().applyAlg(new Alg(seedScramble));
  const targetPattern = buildWhiteCrossTarget(
    kpuzzle,
    seedPattern,
    requestedMoves,
    random,
  );
  const scramble = (await solveAlg(targetPattern)).invert().toString();
  const generatedPattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));

  if (whiteCrossDistance(kpuzzle, generatedPattern) !== requestedMoves) {
    throw new Error(
      `Generated scramble did not produce an exact ${requestedMoves}-move white cross`,
    );
  }
  return scramble;
}

function assertWhiteCrossMoves(moves: number): asserts moves is WhiteCrossMoves {
  if (
    !Number.isInteger(moves) ||
    moves < WHITE_CROSS_MIN_MOVES ||
    moves > WHITE_CROSS_MAX_MOVES
  ) {
    throw new Error("White cross moves must be between 1 and 7");
  }
}

function whiteDownRotation(): Alg {
  const whiteFace = faceOfColour("white");
  if (!whiteFace) throw new Error("The standard colour scheme has no white face");
  return new Alg(rotationForCrossFace(whiteFace).tokens.join(" "));
}

function findExactCrossSetup(
  kpuzzle: KPuzzle,
  solver: ReturnType<typeof crossSolver>,
  requestedMoves: WhiteCrossMoves,
  random: () => number,
): string[] {
  const path: string[] = [];

  function search(pattern: KPattern, depth: number): boolean {
    if (depth === requestedMoves) return true;

    const candidates = [...CROSS_MOVES];
    for (let i = candidates.length - 1; i > 0; i--) {
      const randomIndex = Math.max(
        0,
        Math.min(i, Math.floor(Math.max(0, Math.min(0.999999999, random())) * (i + 1))),
      );
      [candidates[i], candidates[randomIndex]] = [
        candidates[randomIndex],
        candidates[i],
      ];
    }

    for (const move of candidates) {
      const next = pattern.applyMove(move);
      if (solver.lengthFrom(next) !== depth + 1) continue;
      path.push(move);
      if (search(next, depth + 1)) return true;
      path.pop();
    }
    return false;
  }

  if (!search(kpuzzle.defaultPattern(), 0)) {
    throw new Error(`Could not construct a ${requestedMoves}-move white-cross setup`);
  }
  return path;
}
