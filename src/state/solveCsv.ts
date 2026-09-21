/**
 * Reading and writing the solve analysis export.
 *
 * The format is one row per solve with 164 columns: the solve itself, then nine slots
 * of per-step analysis. Everything in it maps onto this app's own model — the phases
 * are the same seven CFOP steps — so imported solves behave exactly like recorded
 * ones, and an export written here can be read back by whatever produced it.
 */
import { STEP_NAMES, type SolveAnalysis, type SolveStep, type StepName } from "../cube/analysis";
import { FACES, type Face } from "../cube/moves";
import {
  countTurns,
  formatMoveList,
  formatTimedMoves,
  parseMove,
  parseTimedMoves,
  type TimedMove,
} from "../cube/notation";
import { formatCsv, parseCsv, splitCsvLines } from "./csv";
import type { Session, Solve } from "./types";

const STEP_SLOTS = 9;

const BASE_COLUMNS = [
  "id", "date", "dnf", "time", "solving_method", "device_name", "device_model",
  "device_color_scheme", "user", "one_turn_away_two_second_penalty",
  "inspection_two_second_penalty", "inspection_time", "timer_time", "missing_turn",
  "solution", "timer", "description", "session_name", "session_ruleset", "scramble",
  "scramble_provider", "ruleset", "share_views", "share_likes", "share_comments",
  "analysis_version", "solution_rotation", "pickup_time", "putdown_time",
  "solving_time", "slice_turns", "face_turns", "quarter_turns", "turns_per_second",
  "total_recognition_time", "total_execution_time", "turns_after_solution",
  "steps_skipped",
] as const;

const STEP_FIELDS = [
  "name", "moves", "recorded_moves", "skipped", "has_turns", "time",
  "recognition_time", "execution_time", "cumulative_time", "slice_turns",
  "face_turns", "quarter_turns", "turns_per_second",
] as const;

/** The full column list, in the order the export writes them. */
export const SOLVE_CSV_COLUMNS: string[] = [
  ...BASE_COLUMNS,
  ...Array.from({ length: STEP_SLOTS }, (_, i) =>
    STEP_FIELDS.map((field) => `step_${i}_${field}`),
  ).flat(),
  ...Array.from({ length: STEP_SLOTS }, (_, i) => `step_${i}_case`),
];

export function looksLikeSolveCsv(text: string): boolean {
  const firstLine = text.slice(0, 4096).split(/\r?\n/, 1)[0] ?? "";
  return firstLine.startsWith("id,date,dnf,time,solving_method");
}

// ------------------------------------------------------------------ reading

/**
 * Rates are written rounded to two decimals, with at least one decimal kept:
 * `8.0`, not `8` or `8.00`.
 */
function formatRate(value: number): string {
  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `2023-09-06 10:17:49 UTC` */
function parseDate(value: string): number {
  const parsed = Date.parse(value.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatDate(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * Work out which face the cross was built on.
 *
 * The raw move stream is in the cube's frame and the per-step moves are in the frame
 * the solver held it in, so lining the two up by timestamp reveals how the faces were
 * relabelled — and the face that became `D` is the cross.
 */
function deriveCrossFace(raw: TimedMove[], recorded: TimedMove[]): Face | null {
  const rawByTime = new Map<number, string>();
  for (const { move, t } of raw) {
    const parsed = parseMove(move);
    if (parsed) rawByTime.set(t, parsed.family);
  }
  for (const { move, t } of recorded) {
    const parsed = parseMove(move);
    if (!parsed || parsed.family !== "D") continue;
    const original = rawByTime.get(t);
    if (original && (FACES as readonly string[]).includes(original)) {
      return original as Face;
    }
  }
  return null;
}

function readStep(
  row: Record<string, string>,
  slot: number,
  raw: TimedMove[],
  fromMove: number,
): { step: SolveStep; toMove: number } | null {
  const name = row[`step_${slot}_name`];
  if (!name) return null;
  const recordedMoves = parseTimedMoves(row[`step_${slot}_recorded_moves`] ?? "");
  const cumulativeMs = num(row[`step_${slot}_cumulative_time`]);
  // The export does not index into the raw stream, so recover the range by time.
  let toMove = fromMove;
  while (toMove < raw.length && raw[toMove].t <= cumulativeMs) toMove++;

  return {
    toMove,
    step: {
      name: name as StepName,
      moves: row[`step_${slot}_moves`] ?? "",
      recordedMoves,
      skipped: row[`step_${slot}_skipped`] === "true",
      hasTurns: row[`step_${slot}_has_turns`] === "true",
      timeMs: num(row[`step_${slot}_time`]),
      recognitionMs: num(row[`step_${slot}_recognition_time`]),
      executionMs: num(row[`step_${slot}_execution_time`]),
      cumulativeMs,
      sliceTurns: num(row[`step_${slot}_slice_turns`]),
      faceTurns: num(row[`step_${slot}_face_turns`]),
      quarterTurns: num(row[`step_${slot}_quarter_turns`]),
      tps: num(row[`step_${slot}_turns_per_second`]),
      case: row[`step_${slot}_case`] || null,
      // The export names the slot in the frame the solver held the cube in, which says
      // nothing about which colours meet there, so it is left unset and the case string
      // carries that information instead.
      slot: null,
      fromMove,
      toMove,
    },
  };
}

function readAnalysis(
  row: Record<string, string>,
  raw: TimedMove[],
): SolveAnalysis | null {
  const steps: SolveStep[] = [];
  let fromMove = 0;
  for (let slot = 0; slot < STEP_SLOTS; slot++) {
    const read = readStep(row, slot, raw, fromMove);
    if (!read) continue;
    steps.push(read.step);
    fromMove = read.toMove;
  }
  if (steps.length === 0) return null;

  const crossFace =
    deriveCrossFace(raw, steps.flatMap((s) => s.recordedMoves)) ?? "D";
  const pauses: SolveAnalysis["pauses"] = [];
  for (let i = 1; i < raw.length; i++) {
    const gap = raw[i].t - raw[i - 1].t;
    if (gap >= 250) {
      pauses.push({ afterMove: i - 1, startMs: raw[i - 1].t, durationMs: gap });
    }
  }

  return {
    method: "CFOP",
    crossFace,
    rotation: row.solution_rotation ?? "",
    steps,
    solvingMs: num(row.solving_time),
    sliceTurns: num(row.slice_turns),
    faceTurns: num(row.face_turns),
    quarterTurns: num(row.quarter_turns),
    tps: num(row.turns_per_second),
    totalRecognitionMs: num(row.total_recognition_time),
    totalExecutionMs: num(row.total_execution_time),
    stepsSkipped: num(row.steps_skipped),
    turnsAfterSolution: num(row.turns_after_solution),
    pauses,
  };
}

export type SolveCsvImport = {
  sessions: Session[];
  solves: Solve[];
  /** Rows that could not be read, with the reason. */
  skipped: { line: number; reason: string }[];
};

/** Read a solve analysis export into sessions and solves. */
export function parseSolveCsv(text: string): SolveCsvImport {
  const rows = parseCsv(text);
  const sessions = new Map<string, Session>();
  const solves: Solve[] = [];
  const skipped: { line: number; reason: string }[] = [];

  rows.forEach((row, index) => {
    if (!row.id) {
      skipped.push({ line: index + 2, reason: "no solve id" });
      return;
    }
    const sessionName = row.session_name || "Imported";
    // A stable id means importing the same file twice merges instead of duplicating.
    const sessionId = `import:${sessionName}`;
    const createdAt = parseDate(row.date);
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        id: sessionId,
        name: sessionName,
        event: "333",
        createdAt,
      });
    }

    const moves = parseTimedMoves(row.solution ?? "");
    const dnf = row.dnf === "true";
    const plus2 =
      row.inspection_two_second_penalty === "true" ||
      row.one_turn_away_two_second_penalty === "true";

    solves.push({
      id: row.id,
      sessionId,
      createdAt,
      // `timer_time` is what the cube measured; `time` already has the penalty in it.
      rawMs: num(row.timer_time || row.solving_time || row.time),
      penalty: dnf ? "DNF" : plus2 ? "+2" : "none",
      scramble: row.scramble ?? "",
      event: "333",
      source: "import",
      moves,
      analysis: dnf ? null : readAnalysis(row, moves),
      comment: row.description || undefined,
      inspectionMs: row.inspection_time ? num(row.inspection_time) : undefined,
      device: row.device_name
        ? {
            name: row.device_name,
            model: row.device_model || undefined,
            colorScheme: row.device_color_scheme || undefined,
          }
        : undefined,
      user: row.user || undefined,
      ruleset: row.ruleset || undefined,
      sessionRuleset: row.session_ruleset || undefined,
      scrambleProvider: row.scramble_provider || undefined,
      solvingMethod: row.solving_method || undefined,
      analysisVersion: row.analysis_version ? num(row.analysis_version) : undefined,
      oneTurnAwayPenalty: row.one_turn_away_two_second_penalty === "true" || undefined,
    });
  });

  return { sessions: [...sessions.values()], solves, skipped };
}

/** Number of data rows in a document, without parsing them. */
export function countSolveCsvRows(text: string): number {
  return Math.max(0, splitCsvLines(text).filter((l) => l.trim().length > 0).length - 1);
}

/**
 * Read an export a batch at a time.
 *
 * A full archive runs to tens of thousands of solves and hundreds of megabytes, which
 * is far too much to parse and store in one go without the page going unresponsive.
 */
export function* solveCsvBatches(
  text: string,
  batchSize = 200,
): Generator<SolveCsvImport> {
  const lines = splitCsvLines(text).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return;
  const header = lines[0];
  for (let start = 1; start < lines.length; start += batchSize) {
    yield parseSolveCsv(
      [header, ...lines.slice(start, start + batchSize)].join("\n"),
    );
  }
}

// ------------------------------------------------------------------ writing

function writeStep(row: Record<string, string>, slot: number, step: SolveStep): void {
  const put = (field: (typeof STEP_FIELDS)[number], value: string) => {
    row[`step_${slot}_${field}`] = value;
  };
  put("name", step.name);
  put("moves", step.moves || formatMoveList(step.recordedMoves));
  put("recorded_moves", formatTimedMoves(step.recordedMoves));
  put("skipped", String(step.skipped));
  put("has_turns", String(step.hasTurns));
  put("time", String(Math.round(step.timeMs)));
  put("recognition_time", String(Math.round(step.recognitionMs)));
  put("execution_time", String(Math.round(step.executionMs)));
  put("cumulative_time", String(Math.round(step.cumulativeMs)));
  put("slice_turns", String(step.sliceTurns));
  put("face_turns", String(step.faceTurns));
  put("quarter_turns", String(step.quarterTurns));
  // No turning time at all: nothing divided by nothing is written as zero, but a turn
  // divided by nothing has no representable rate and is left blank.
  put(
    "turns_per_second",
    step.executionMs > 0
      ? formatRate(step.tps)
      : step.sliceTurns === 0
        ? "0"
        : "",
  );
  row[`step_${slot}_case`] = step.case ?? "";
}

export function solveToCsvRow(
  solve: Solve,
  sessionName: string,
): Record<string, string> {
  const analysis = solve.analysis ?? null;
  const dnf = solve.penalty === "DNF";
  // A solve with no moves recorded — a DNF that was never finished — leaves every
  // measured column blank rather than claiming zero of everything.
  const measured = solve.moves.length > 0;
  const turns = analysis ?? countTurns(solve.moves.map((m) => m.move));
  const count = (value: number) => (measured ? String(value) : "");
  const effective = solve.rawMs + (solve.penalty === "+2" ? 2000 : 0);

  const row: Record<string, string> = {
    id: solve.id,
    date: formatDate(solve.createdAt),
    dnf: String(dnf),
    time: dnf ? "" : String(Math.round(effective)),
    solving_method: solve.solvingMethod ?? analysis?.method ?? "CFOP",
    device_name: solve.device?.name ?? "",
    device_model: solve.device?.model ?? "",
    device_color_scheme: solve.device?.colorScheme ?? "",
    user: solve.user ?? "",
    one_turn_away_two_second_penalty: String(solve.oneTurnAwayPenalty === true),
    inspection_two_second_penalty: String(
      solve.penalty === "+2" && solve.oneTurnAwayPenalty !== true,
    ),
    inspection_time: solve.inspectionMs ? String(Math.round(solve.inspectionMs)) : "",
    timer_time: dnf ? "" : String(Math.round(solve.rawMs)),
    missing_turn: "",
    solution: formatTimedMoves(solve.moves),
    timer: "",
    description: solve.comment ?? "",
    session_name: sessionName,
    session_ruleset: solve.sessionRuleset ?? "custom_rules",
    scramble: solve.scramble,
    scramble_provider: solve.scrambleProvider ?? "random_state",
    ruleset: solve.ruleset ?? "custom_rules",
    share_views: "",
    share_likes: "",
    share_comments: "",
    analysis_version: solve.analysisVersion ? String(solve.analysisVersion) : "8",
    solution_rotation: analysis?.rotation ?? "",
    pickup_time: "0",
    putdown_time: "0",
    solving_time: dnf ? "" : String(Math.round(analysis?.solvingMs ?? solve.rawMs)),
    slice_turns: count(turns.sliceTurns),
    face_turns: count(turns.faceTurns),
    quarter_turns: count(turns.quarterTurns),
    turns_per_second: analysis ? formatRate(analysis.tps) : "",
    total_recognition_time: analysis ? String(Math.round(analysis.totalRecognitionMs)) : "",
    total_execution_time: analysis ? String(Math.round(analysis.totalExecutionMs)) : "",
    turns_after_solution: analysis?.turnsAfterSolution
      ? String(analysis.turnsAfterSolution)
      : "",
    steps_skipped: analysis ? String(analysis.stepsSkipped) : "",
  };

  // The seven CFOP phases are always named, even on a solve that was never finished:
  // the scaffold is part of the format, the measurements are what go missing.
  for (const [slot, name] of STEP_NAMES.entries()) row[`step_${slot}_name`] = name;
  for (const [slot, step] of (analysis?.steps ?? []).entries()) {
    if (slot < STEP_SLOTS) writeStep(row, slot, step);
  }
  for (const column of SOLVE_CSV_COLUMNS) row[column] ??= "";
  return row;
}

export function formatSolveCsv(
  solves: readonly Solve[],
  sessionNames: ReadonlyMap<string, string>,
): string {
  return formatCsv(
    SOLVE_CSV_COLUMNS,
    solves.map((solve) =>
      solveToCsvRow(solve, sessionNames.get(solve.sessionId) ?? "Session"),
    ),
  );
}

export { STEP_NAMES };
