import type { SolveAnalysis, TimedMove } from "../cube/analysis";
import type { EventId } from "../cube/scramble";

export type Penalty = "none" | "+2" | "DNF";

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
  source: "smartcube" | "keyboard";
  /** Move stream, present only for smart cube solves. */
  moves: TimedMove[];
  /** Cube state the solve started from, as a facelet string. */
  scrambledFacelets?: string;
  analysis?: SolveAnalysis | null;
  comment?: string;
};

/** The time a solve counts for, with its penalty applied. `null` means DNF. */
export function effectiveMs(solve: Solve): number | null {
  if (solve.penalty === "DNF") return null;
  return solve.rawMs + (solve.penalty === "+2" ? 2000 : 0);
}

export type Settings = {
  event: EventId;
  inspection: boolean;
  /** Begin inspection as soon as the cube reaches the scrambled state. */
  autoInspection: boolean;
  /** Require the cube to be scrambled before the timer will arm. */
  requireScramble: boolean;
  holdToStart: boolean;
  hideTimeWhileSolving: boolean;
  visualization: "3D" | "2D" | "off";
  showBackView: boolean;
  useGyroscope: boolean;
  sound: boolean;
  theme: "dark" | "light";
};

export const DEFAULT_SETTINGS: Settings = {
  event: "333",
  inspection: false,
  autoInspection: true,
  requireScramble: true,
  holdToStart: true,
  hideTimeWhileSolving: false,
  visualization: "3D",
  showBackView: true,
  useGyroscope: true,
  sound: true,
  theme: "dark",
};
