import type { SolveAnalysis, TimedMove } from "../cube/analysis";
import type { EventId } from "../cube/scramble";

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
  event: EventId;
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
  event: EventId;
  /**
   * Take the clock away: solve slowly and deliberately, and study the breakdown.
   * These solves are still recorded and analysed but never counted in the statistics.
   */
  slowSolve: boolean;
  /** Maximum solution length used when looking for an XCross scramble. */
  xCrossMaxMoves: XCrossMaxMoves;
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
  event: "333",
  slowSolve: false,
  xCrossMaxMoves: 5,
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
