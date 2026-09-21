import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOLVE_CSV_COLUMNS,
  formatSolveCsv,
  looksLikeSolveCsv,
  parseSolveCsv,
} from "./solveCsv";
import { parseCsv } from "./csv";

const sample = readFileSync(
  new URL("./__fixtures__/solve-export-sample.csv", import.meta.url),
  "utf8",
);

describe("solve analysis CSV", () => {
  it("knows the format's columns exactly", () => {
    expect(SOLVE_CSV_COLUMNS).toHaveLength(164);
    expect(sample.split("\n")[0].split(",")).toEqual(SOLVE_CSV_COLUMNS);
    expect(looksLikeSolveCsv(sample)).toBe(true);
    expect(looksLikeSolveCsv("a,b,c\n1,2,3")).toBe(false);
  });

  const { solves, sessions, skipped } = parseSolveCsv(sample);

  it("reads every row", () => {
    expect(skipped).toEqual([]);
    expect(solves).toHaveLength(5);
    expect(sessions.length).toBeGreaterThan(0);
    expect(solves.every((s) => s.source === "import")).toBe(true);
  });

  it("keeps the solve's own timing and penalties apart", () => {
    const plus2 = solves.find((s) => s.penalty === "+2")!;
    expect(plus2).toBeDefined();
    // `time` in the file carries the penalty; `timer_time` is what the cube measured.
    expect(plus2.rawMs).toBeGreaterThan(0);
    expect(plus2.inspectionMs).toBeGreaterThan(15_000);

    const dnf = solves.find((s) => s.penalty === "DNF")!;
    expect(dnf).toBeDefined();
    expect(dnf.analysis).toBeNull();
    expect(dnf.moves).toEqual([]);
  });

  it("reads the seven CFOP steps with their cases", () => {
    const solved = solves.find((s) => s.analysis)!;
    const analysis = solved.analysis!;
    expect(analysis.steps.map((s) => s.name)).toEqual([
      "Cross",
      "F2L Slot 1",
      "F2L Slot 2",
      "F2L Slot 3",
      "F2L Slot 4",
      "OLL",
      "PLL",
    ]);
    expect(analysis.steps[0].case).toBeNull();
    expect(analysis.steps[6].case).toMatch(/^[A-Z][a-z]?$|Solved/);
    // Step times add up to the solve, and each splits into recognition and execution.
    for (const step of analysis.steps) {
      expect(step.recognitionMs + step.executionMs, step.name).toBe(step.timeMs);
    }
    expect(analysis.steps.at(-1)!.cumulativeMs).toBe(analysis.solvingMs);
  });

  it("recovers which face the cross was built on", () => {
    for (const solve of solves.filter((s) => s.analysis)) {
      expect("URFDLB", solve.id).toContain(solve.analysis!.crossFace);
    }
  });

  it("indexes each step into the raw move stream", () => {
    const analysis = solves.find((s) => s.analysis)!.analysis!;
    expect(analysis.steps[0].fromMove).toBe(0);
    for (let i = 1; i < analysis.steps.length; i++) {
      expect(analysis.steps[i].fromMove).toBe(analysis.steps[i - 1].toMove);
    }
  });

  it("round-trips through a written export", () => {
    const names = new Map(sessions.map((s) => [s.id, s.name]));
    const written = formatSolveCsv(solves, names);
    expect(written.split("\n")[0].split(",")).toEqual(SOLVE_CSV_COLUMNS);

    const reread = parseSolveCsv(written);
    expect(reread.solves).toHaveLength(solves.length);
    for (const [i, solve] of reread.solves.entries()) {
      const original = solves[i];
      expect(solve.id).toBe(original.id);
      expect(solve.rawMs).toBe(original.rawMs);
      expect(solve.penalty).toBe(original.penalty);
      expect(solve.scramble).toBe(original.scramble);
      expect(solve.createdAt).toBe(original.createdAt);
      expect(solve.moves).toEqual(original.moves);
      expect(solve.device).toEqual(original.device);
      expect(solve.analysis?.steps.map((s) => s.case)).toEqual(
        original.analysis?.steps.map((s) => s.case),
      );
      expect(solve.analysis?.steps.map((s) => s.recordedMoves)).toEqual(
        original.analysis?.steps.map((s) => s.recordedMoves),
      );
    }
  });

  it("writes values that match the original file, field for field", () => {
    const names = new Map(sessions.map((s) => [s.id, s.name]));
    const originalRows = parseCsv(sample);
    const writtenRows = parseCsv(formatSolveCsv(solves, names));
    // Columns this app does not model are allowed to differ; the rest must not.
    const ignore = new Set([
      "share_views", "share_likes", "share_comments", "timer", "missing_turn",
      "pickup_time", "putdown_time", "analysis_version", "solution_rotation",
    ]);
    for (const [i, original] of originalRows.entries()) {
      for (const column of SOLVE_CSV_COLUMNS) {
        if (ignore.has(column)) continue;
        expect(
          writtenRows[i][column],
          `row ${i} column ${column}`,
        ).toBe(original[column]);
      }
    }
  });
});

describe("solves recorded here, written in the export format", () => {
  it("survives a round trip with its analysis intact", async () => {
    const { Alg } = await import("cubing/alg");
    const { analyseSolve } = await import("../cube/analysis");
    const { get3x3x3 } = await import("../cube/puzzle");
    const kpuzzle = await get3x3x3();

    // A solve built backwards from solved, the same way the analyser tests do it.
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
    const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
    const solution = new Alg(scramble).invert();
    const moves = Array.from(solution.expand().childAlgNodes()).flatMap((node) => {
      const move = node.toString();
      const match = /^([URFDLB])(2'?|')?$/.exec(move)!;
      const suffix = match[2] ?? "";
      return suffix.startsWith("2")
        ? [match[1], match[1]]
        : [match[1] + suffix];
    });
    const timed = moves.map((move, i) => ({ move, t: (i + 1) * 150 }));

    const solve = {
      id: "local-1",
      sessionId: "s1",
      createdAt: Date.UTC(2026, 8, 20, 12, 0, 0),
      rawMs: timed.at(-1)!.t,
      penalty: "none" as const,
      scramble,
      event: "333" as const,
      source: "smartcube" as const,
      moves: timed,
      analysis: analyseSolve(scrambled, timed),
      device: { name: "GAN 12 ui", model: "Gan 12 UI FreePlay", colorScheme: "BOY" },
      inspectionMs: 8000,
    };
    expect(solve.analysis).not.toBeNull();

    const csv = formatSolveCsv([solve], new Map([["s1", "Evening"]]));
    const { solves: [reread] } = parseSolveCsv(csv);

    expect(reread.id).toBe("local-1");
    expect(reread.createdAt).toBe(solve.createdAt);
    expect(reread.rawMs).toBe(solve.rawMs);
    expect(reread.scramble).toBe(scramble);
    expect(reread.device).toEqual(solve.device);
    expect(reread.inspectionMs).toBe(8000);
    expect(reread.moves).toEqual(timed);

    const before = solve.analysis!;
    const after = reread.analysis!;
    expect(after.crossFace).toBe(before.crossFace);
    expect(after.sliceTurns).toBe(before.sliceTurns);
    expect(after.quarterTurns).toBe(before.quarterTurns);
    expect(after.steps.map((s) => s.name)).toEqual(before.steps.map((s) => s.name));
    expect(after.steps.map((s) => s.moves)).toEqual(before.steps.map((s) => s.moves));
    expect(after.steps.map((s) => s.timeMs)).toEqual(before.steps.map((s) => s.timeMs));
    expect(after.steps.map((s) => s.recognitionMs)).toEqual(
      before.steps.map((s) => s.recognitionMs),
    );
    expect(after.steps.map((s) => s.sliceTurns)).toEqual(
      before.steps.map((s) => s.sliceTurns),
    );
  });
});

describe("case recognition against the export's own labels", () => {
  const { solves } = parseSolveCsv(sample);

  it("names the same OLL and PLL cases the file does", async () => {
    const { Alg } = await import("cubing/alg");
    const { analyseSolve } = await import("../cube/analysis");
    const { get3x3x3 } = await import("../cube/puzzle");
    const kpuzzle = await get3x3x3();

    let compared = 0;
    for (const solve of solves) {
      const theirs = solve.analysis;
      if (!theirs || solve.moves.length === 0) continue;
      const mine = analyseSolve(
        kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble)),
        solve.moves,
      );
      if (!mine) continue;

      // Only comparable where both put the step boundary in the same place.
      for (const index of [5, 6]) {
        const mineStep = mine.steps[index];
        const theirStep = theirs.steps[index];
        if (
          !theirStep.case ||
          mineStep.cumulativeMs !== theirStep.cumulativeMs ||
          mine.steps[index - 1].cumulativeMs !== theirs.steps[index - 1].cumulativeMs
        ) {
          continue;
        }
        compared++;
        expect(mineStep.case, `${solve.id} ${theirStep.name}`).toBe(theirStep.case);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
