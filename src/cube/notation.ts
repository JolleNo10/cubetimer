/**
 * Move notation shared by the analyser and the solve analysis CSV codec.
 *
 * The vocabulary is the one that appears in smart cube solve data: outer face turns
 * (U R F D L B), slice moves (M E S) and whole-cube rotations (x y z). Amounts are not
 * reduced modulo 4 — a solver who turns U four times in a row is recorded as `U4'`,
 * because that is what they did.
 */

export const OUTER_FACES = ["U", "R", "F", "D", "L", "B"] as const;
export const SLICES = ["M", "E", "S"] as const;
export const ROTATIONS = ["x", "y", "z"] as const;

export type MoveFamily =
  | (typeof OUTER_FACES)[number]
  | (typeof SLICES)[number]
  | (typeof ROTATIONS)[number];

export type ParsedMove = {
  family: MoveFamily;
  /** Signed quarter turns: 1 = clockwise, -1 = anticlockwise, -2 = `U2'`. */
  amount: number;
};

const MOVE_PATTERN = /^([URFDLBMESxyz])(\d*)('?)$/;

export function parseMove(token: string): ParsedMove | null {
  const match = MOVE_PATTERN.exec(token.trim());
  if (!match) return null;
  const magnitude = match[2] ? Number(match[2]) : 1;
  return {
    family: match[1] as MoveFamily,
    amount: match[3] === "'" ? -magnitude : magnitude,
  };
}

export function formatMove({ family, amount }: ParsedMove): string {
  const magnitude = Math.abs(amount);
  return `${family}${magnitude === 1 ? "" : magnitude}${amount < 0 ? "'" : ""}`;
}

export function isRotation(family: MoveFamily): boolean {
  return family === "x" || family === "y" || family === "z";
}

export function isSlice(family: MoveFamily): boolean {
  return family === "M" || family === "E" || family === "S";
}

/** A quarter turn, a half turn, or nothing; a half turn is never written `2'`. */
function shortestWay(quarters: number): number {
  const turns = ((quarters % 4) + 4) % 4;
  return turns === 3 ? -1 : turns;
}

/**
 * Stitch sequences of moves together, adding up the turns that meet at the joins.
 *
 * A `U2` running into a `U'` is one `U`, and a face turned straight back to where it
 * was disappears — which is what makes a lined-up algorithm read like one sequence
 * rather than like the two it was assembled from. Only turns that end up next to each
 * other are combined; anything between them, a rotation included, keeps them apart.
 * Tokens that are not moves are passed through untouched.
 *
 * This is the one place amounts are reduced modulo 4. A recorded move stream keeps
 * what the solver did, `U4'` and all; a sequence being handed to someone to perform
 * should say the shortest thing that gets there.
 */
export function joinMoves(...sequences: readonly (readonly string[])[]): string[] {
  const joined: (ParsedMove | string)[] = [];
  for (const move of sequences.flat()) {
    const parsed = parseMove(move);
    if (!parsed) {
      joined.push(move);
      continue;
    }
    const previous = joined[joined.length - 1];
    let quarters = parsed.amount;
    if (typeof previous === "object" && previous.family === parsed.family) {
      quarters += previous.amount;
      joined.pop();
    }
    const amount = shortestWay(quarters);
    if (amount !== 0) joined.push({ family: parsed.family, amount });
  }
  return joined.map((move) => (typeof move === "string" ? move : formatMove(move)));
}

/**
 * The moves that put the cube back where the sequence started: the same turns
 * backwards, each the other way round.
 *
 * Turns of the same face that meet once the order is reversed are added up, so undoing
 * `R U U' R'` is nothing at all rather than four moves that cancel under your fingers.
 */
export function invertMoves(moves: readonly string[]): string[] {
  return joinMoves(
    [...moves].reverse().map((move) => {
      const parsed = parseMove(move);
      if (!parsed) return move;
      return formatMove({ family: parsed.family, amount: -parsed.amount });
    }),
  );
}

/**
 * The three turn counts every solve is measured in. Rotations count for nothing in all
 * three; a slice move is one turn in STM but two faces moving in the other two.
 */
export type TurnMetrics = {
  /** Slice Turn Metric: every move counts once. */
  sliceTurns: number;
  /** Execution/outer-block metric: a slice counts as two. */
  faceTurns: number;
  /** Quarter Turn Metric: a half turn counts twice, a slice twice again. */
  quarterTurns: number;
};

export const NO_TURNS: TurnMetrics = {
  sliceTurns: 0,
  faceTurns: 0,
  quarterTurns: 0,
};

export function countTurns(moves: Iterable<string | ParsedMove>): TurnMetrics {
  let sliceTurns = 0;
  let faceTurns = 0;
  let quarterTurns = 0;
  for (const move of moves) {
    const parsed = typeof move === "string" ? parseMove(move) : move;
    if (!parsed || isRotation(parsed.family)) continue;
    const doubled = isSlice(parsed.family) ? 2 : 1;
    sliceTurns += 1;
    faceTurns += doubled;
    quarterTurns += Math.abs(parsed.amount) * doubled;
  }
  return { sliceTurns, faceTurns, quarterTurns };
}

export function addTurns(a: TurnMetrics, b: TurnMetrics): TurnMetrics {
  return {
    sliceTurns: a.sliceTurns + b.sliceTurns,
    faceTurns: a.faceTurns + b.faceTurns,
    quarterTurns: a.quarterTurns + b.quarterTurns,
  };
}

/** A move with the time, in milliseconds from the start of the solve, it finished at. */
export type TimedMove = {
  move: string;
  t: number;
};

/** Parse `"R[0] U'[287] F2[1191]"`, the form solve data records a move stream in. */
export function parseTimedMoves(text: string): TimedMove[] {
  const moves: TimedMove[] = [];
  for (const match of text.matchAll(/(\S+?)\[(-?\d+)\]/g)) {
    moves.push({ move: match[1], t: Number(match[2]) });
  }
  return moves;
}

export function formatTimedMoves(moves: readonly TimedMove[]): string {
  return moves.map(({ move, t }) => `${move}[${t}]`).join(" ");
}

export function formatMoveList(moves: readonly TimedMove[]): string {
  return moves.map(({ move }) => move).join(" ");
}

/**
 * How long a pause can be before two turns of the same face count as two moves rather
 * than one motion. Measured from a real export: no merged pair is ever further apart
 * than this, and no same-direction pair closer than it is left unmerged.
 */
export const MERGE_WINDOW_MS = 750;

/**
 * Collapse runs of turns on the same face into the single move a human would write:
 * two quick `D'` turns are one `D2'`. The merged move keeps the timestamp of the last
 * turn, since that is when the face finished moving.
 *
 * Turns only merge when they go the same way and follow each other closely. A `U` and
 * a `U'` are a correction, not a half turn, and two turns a second apart are two
 * decisions — both stay as they were made.
 */
export function mergeSameFaceTurns(
  moves: readonly TimedMove[],
  windowMs: number = MERGE_WINDOW_MS,
): TimedMove[] {
  const merged: TimedMove[] = [];
  let run: { family: MoveFamily; amount: number; t: number } | null = null;

  const flush = () => {
    if (run) {
      merged.push({
        move: formatMove({ family: run.family, amount: run.amount }),
        t: run.t,
      });
    }
    run = null;
  };

  for (const { move, t } of moves) {
    const parsed = parseMove(move);
    if (!parsed) {
      flush();
      merged.push({ move, t });
      continue;
    }
    const continuesRun =
      run !== null &&
      run.family === parsed.family &&
      Math.sign(run.amount) === Math.sign(parsed.amount) &&
      t - run.t < windowMs;
    if (continuesRun && run) {
      run.amount += parsed.amount;
      run.t = t;
    } else {
      flush();
      run = { family: parsed.family, amount: parsed.amount, t };
    }
  }
  flush();
  return merged;
}
