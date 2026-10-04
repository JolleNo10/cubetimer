import type { SolveAnalysis, TimedMove } from "../cube/analysis";
import type { WhiteCrossMoves } from "../cube/crossScramble";
import type { EventId } from "../cube/scramble";
import type { LastLayerAuf, LastLayerTrainingSet } from "../cube/lastLayerTraining";
import type { F2lTrainingLibrary } from "../cube/f2lTrainingCases";
import type { F2lPosition } from "../cube/f2lCases";

/** User-authored reusable configuration, independent of live runs and Timer Sessions. */
export type TrainingDrillPresetContext =
  | { family: "f2l"; library: F2lTrainingLibrary; position: F2lPosition }
  | { family: "oll" | "pll"; trainingSet: LastLayerTrainingSet };
export type TrainingDrillTask = "execution" | "recognition";
export type TrainingDrillStrategy = "sequence" | "random" | "weighted";
export type TrainingDrillPreset = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  context: TrainingDrillPresetContext;
  strategy: TrainingDrillStrategy;
  task: TrainingDrillTask;
  caseIds: string[];
};

/** Durable catalogue identity: AUF and live target state never split a case. */
export type TrainingCatalogueIdentity =
  | (Extract<TrainingDrillPresetContext, { family: "f2l" }> & { caseName: string })
  | (Extract<TrainingDrillPresetContext, { family: "oll" | "pll" }> & { caseId: string });

export type TrainingAlgorithmPreference = {
  key: string;
  target: TrainingCatalogueIdentity;
  /** Stable source/core notation, never a live target's AUF-adjusted reference. */
  algorithm: string;
  source: "catalog" | "custom";
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Global Training history, independent of Timer Session/Event identity. */
export type TrainingAttemptTarget =
  | { family: "f2l"; origin: "catalog"; library: F2lTrainingLibrary; caseName: string; position: F2lPosition }
  | { family: "f2l"; origin: "solve-step"; solveId: string; stepName: string; position: F2lPosition; recognizedCaseName?: string }
  | { family: "oll" | "pll"; origin: "catalog"; trainingSet: LastLayerTrainingSet; caseId: string; auf: LastLayerAuf }
  | { family: "oll" | "pll"; origin: "solve-step"; solveId: string; stepName: "OLL" | "PLL"; trainingSet: "full"; caseId: string; auf: LastLayerAuf };

export type TrainingRecognitionAttempt = {
  id: string;
  createdAt: number;
  drillRunId: string;
  drillRound: number;
  target: TrainingCatalogueIdentity;
  answerCaseId: string;
  responseMs: number;
};

export type TrainingAttempt = {
  id: string;
  createdAt: number;
  mode: "setup" | "virtual";
  activity: "single" | "drill";
  drillRunId: string | null;
  drillRound: number | null;
  /** Case reveal to completion for Drill; null for Single. */
  caseTimeMs: number | null;
  target: TrainingAttemptTarget;
  moves: string[];
  stm: number;
  /** Registered move span: first registered move to last registered move. */
  elapsedMs: number;
  recommendedStm: number | null;
  matchedReferenceRank: number | null;
  delta: number | null;
  preferredStm: number | null;
  matchedPreferred: boolean | null;
  preferredDelta: number | null;
};

export type { WhiteCrossMoves } from "../cube/crossScramble";

export type Penalty = "none" | "+2" | "DNF";

export type XCrossMaxMoves = 4 | 5 | 6;

export type Session = {
  id: string;
  name: string;
  event: EventId;
  createdAt: number;
};

export type Solve = {
  id: string;
  sessionId: string;
  createdAt: number;
  /** Raw time in milliseconds, before any penalty. */
  rawMs: number;
  penalty: Penalty;
  scramble: string;
  source: "smartcube" | "keyboard" | "import";
  /** Move stream, present only for smart cube solves. */
  moves: TimedMove[];
  /** Cube state the solve started from, as a facelet string. */
  scrambledFacelets?: string;
  /**
   * How the cube was held for each move, when the gyroscope was there to say.
   *
   * Written by `encodeGripTrack`: the turn made during inspection, then two letters a
   * move. Kept so a rebuilt breakdown can still name the faces the solver was looking
   * at, long after the readings themselves are gone.
   */
  gripTrack?: string;
  analysis?: SolveAnalysis | null;
  comment?: string;
  /**
   * A solve done deliberately rather than quickly. It is still recorded and analysed,
   * but its time means nothing, so it is kept out of averages and personal bests.
   */
  practice?: boolean;
  /** True when the solve was started from a replayed scramble rather than a fresh one. */
  replay?: boolean;
  /** True when the solve was deliberately made in slow/practice timing mode. */
  slowSolve?: boolean;

  // Fields carried by the solve analysis model. They are optional because a solve
  // recorded here only fills in what it actually knows, but they survive a
  // round-trip through an export so nothing is lost by importing into this app.

  /** How long inspection lasted, in milliseconds. */
  inspectionMs?: number;
  device?: { name?: string; model?: string; colorScheme?: string };
  user?: string;
  /** Which rules the solve was judged under, e.g. `custom_rules`. */
  ruleset?: string;
  sessionRuleset?: string;
  /** Where the scramble came from, e.g. `random_state`. */
  scrambleProvider?: string;
  /** Solving method the analysis assumed, e.g. `CFOP`. */
  solvingMethod?: string;
  analysisVersion?: number;
  /** The +2 given for finishing one turn away from solved. */
  oneTurnAwayPenalty?: boolean;
};

/** The time a solve counts for, with its penalty applied. `null` means DNF. */
export function effectiveMs(solve: Solve): number | null {
  if (solve.penalty === "DNF") return null;
  return solve.rawMs + (solve.penalty === "+2" ? 2000 : 0);
}

export type Settings = {
  /** Catalogue libraries for Training only; historical solve analysis is unchanged. */
  ollTrainingSet: LastLayerTrainingSet;
  pllTrainingSet: LastLayerTrainingSet;
  /**
   * Take the clock away: solve slowly and deliberately, and study the breakdown.
   * These solves are still recorded and analysed but never counted in the statistics.
   */
  slowSolve: boolean;
  /** Maximum solution length used when looking for an XCross scramble. */
  xCrossMaxMoves: XCrossMaxMoves;
  /** Exact optimal length of the generated white cross in Slow Solve. */
  whiteCrossMoves: WhiteCrossMoves;
  inspection: boolean;
  /** Begin inspection as soon as the cube reaches the scrambled state. */
  autoInspection: boolean;
  /** Require the cube to be scrambled before the timer will arm. */
  requireScramble: boolean;
  holdToStart: boolean;
  hideTimeWhileSolving: boolean;
  visualization: "3D" | "2D" | "off";
  /**
   * Colour you put on the bottom to solve, by name, or `""` to show the cube the way
   * it was scrambled. Scrambles are always applied white on top and green in front;
   * most solvers then turn the cube over, and the live view follows suit.
   */
  crossColour: string;
  /** Colour you keep facing you, so the on-screen cube matches the one in your hands. */
  frontColour: string;
  showBackView: boolean;
  useGyroscope: boolean;
  sound: boolean;
  theme: "dark" | "light";
};

export const DEFAULT_SETTINGS: Settings = {
  ollTrainingSet: "full",
  pllTrainingSet: "full",
  slowSolve: false,
  xCrossMaxMoves: 5,
  whiteCrossMoves: 5,
  inspection: false,
  autoInspection: true,
  requireScramble: true,
  holdToStart: true,
  hideTimeWhileSolving: false,
  visualization: "3D",
  crossColour: "white",
  frontColour: "green",
  showBackView: true,
  useGyroscope: true,
  sound: true,
  theme: "dark",
};
