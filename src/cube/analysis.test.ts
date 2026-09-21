import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { analyseSolve, type TimedMove } from "./analysis";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

/** Turn an alg into moves timed `step` ms apart, so phase boundaries are easy to read. */
function timed(alg: string, step = 200): TimedMove[] {
  return Array.from(new Alg(alg).expand().childAlgNodes()).map((n, i) => ({
    move: n.toString(),
    t: (i + 1) * step,
  }));
}

describe("analyseSolve", () => {
  // Built backwards from a solved cube: each F2L slot is opened with its own
  // four-move trigger, then OLL and PLL cases are layered on top. The forward
  // solution is therefore a textbook CFOP solve with known phase lengths.
  const extractions = [
    "F U F' U'", // FL slot
    "L U L' U'", // BL slot
    "B U B' U'", // BR slot
    "R U R' U'", // FR slot
  ];
  const oll = "R U R' U R U2' R'"; // Sune
  const pll = "R U R' U' R' F R2 U' R' U' R U R' F'"; // T-perm

  const solution =
    [...extractions].reverse().map((e) => new Alg(e).invert().toString()).join(" ") +
    " " + oll + " " + pll;
  const scrambled = kpuzzle
    .defaultPattern()
    .applyAlg(new Alg(pll).invert())
    .applyAlg(new Alg(oll).invert())
    .applyAlg(new Alg(extractions.join(" ")));

  const analysis = analyseSolve(scrambled, timed(solution))!;
  const byName = Object.fromEntries(analysis.steps.map((s) => [s.name, s]));

  it("recovers the CFOP phase structure", () => {
    expect(analysis.crossFace).toBe("D");
    expect(analysis.method).toBe("CFOP");
    expect(analysis.steps.map((s) => s.name)).toEqual([
      "Cross",
      "F2L Slot 1",
      "F2L Slot 2",
      "F2L Slot 3",
      "F2L Slot 4",
      "OLL",
      "PLL",
    ]);
    expect(byName["Cross"].sliceTurns).toBe(0);
    expect(byName["Cross"].skipped).toBe(true);
    for (const slot of ["F2L Slot 1", "F2L Slot 2", "F2L Slot 3", "F2L Slot 4"]) {
      expect(byName[slot].sliceTurns, slot).toBe(4);
      expect(byName[slot].skipped, slot).toBe(false);
    }
    expect(byName["OLL"].sliceTurns).toBe(7);
    expect(byName["PLL"].sliceTurns).toBe(14);
  });

  it("counts turns in all three metrics", () => {
    // Sune is R U R' U R U2' R': seven moves, one of them a half turn.
    expect(byName["OLL"]).toMatchObject({
      sliceTurns: 7,
      faceTurns: 7,
      quarterTurns: 8,
    });
    expect(analysis.sliceTurns).toBe(16 + 7 + 14);
    // The T-perm contains an R2, so PLL is 14 moves but 15 quarter turns.
    expect(analysis.quarterTurns).toBe(16 + 8 + 15);
    // Step counts always add up to the solve's counts.
    expect(analysis.steps.reduce((n, s) => n + s.sliceTurns, 0)).toBe(
      analysis.sliceTurns,
    );
  });

  it("dates a milestone by when it sticks, not by a lucky moment", () => {
    // PLL breaks and restores F2L slots; none of that may be credited to F2L.
    expect(byName["F2L Slot 4"].toMove).toBe(16);
    expect(byName["F2L Slot 4"].cumulativeMs).toBe(3200);
  });

  it("splits each step into recognition and execution", () => {
    for (const step of analysis.steps) {
      expect(step.recognitionMs + step.executionMs, step.name).toBe(step.timeMs);
    }
    expect(byName["Cross"].recognitionMs).toBe(0);
    // Every F2L trigger here starts with a U, which is an AUF: recognition runs to the
    // second move, 400 ms after the previous step ended.
    expect(byName["F2L Slot 2"].recognitionMs).toBe(400);
    expect(analysis.totalRecognitionMs + analysis.totalExecutionMs).toBe(
      analysis.steps.reduce((sum, s) => sum + s.timeMs, 0),
    );
  });

  it("measures turns per second against turning time, not thinking time", () => {
    const oll = byName["OLL"];
    expect(oll.tps).toBeCloseTo((oll.sliceTurns / oll.executionMs) * 1000, 6);
    expect(analysis.tps).toBeCloseTo(
      (analysis.sliceTurns / analysis.solvingMs) * 1000,
      6,
    );
  });

  it("says which slot each F2L pair filled", () => {
    // The pairs were opened FR, BR, BL, FL, so they are finished in that order.
    expect(
      ["F2L Slot 1", "F2L Slot 2", "F2L Slot 3", "F2L Slot 4"].map(
        (n) => byName[n].slot,
      ),
    ).toEqual(["FR", "BR", "BL", "FL"]);
    expect(byName["Cross"].slot).toBeNull();
    expect(byName["OLL"].slot).toBeNull();
  });

  it("names the last-layer cases", () => {
    // The solve was built with a Sune and a T-perm.
    expect(byName["OLL"].case).toBe("27");
    expect(byName["PLL"].case).toBe("T");
    expect(byName["Cross"].case).toBeNull();
    expect(byName["F2L Slot 1"].case).toBeNull();
  });

  it("calls a skipped last-layer step solved", () => {
    // Same solve without the OLL: the last layer arrives already oriented.
    const skipped = solution.replace(oll + " ", "");
    const from = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg(pll).invert())
      .applyAlg(new Alg(extractions.join(" ")));
    const analysed = analyseSolve(from, timed(skipped))!;
    const ollStep = analysed.steps.find((s) => s.name === "OLL")!;
    expect(ollStep.skipped).toBe(true);
    expect(ollStep.case).toBe("Solved");
    expect(analysed.steps.find((s) => s.name === "PLL")!.case).toBe("T");
  });

  it("rewrites the solve into the frame the solver held", () => {
    // Cross on D means the cube was held as scrambled: no rotation needed.
    expect(analysis.rotation).toBe("DB");
    expect(byName["OLL"].moves).toBe("R U R' U R U2' R'");
  });

  it("reports pauses between moves", () => {
    const moves = timed(solution, 100);
    moves.forEach((m, i) => {
      if (i >= 4) m.t += 900; // a long think after the first pair
    });
    const paused = analyseSolve(scrambled, moves)!;
    expect(paused.pauses).toHaveLength(1);
    expect(paused.pauses[0].durationMs).toBe(1000);
    expect(paused.steps[1].timeMs).toBe(400); // F2L #1 unaffected
  });

  it("does not credit turns made after the cube was solved to any step", () => {
    const extra = [...timed(solution), { move: "R", t: 8000 }];
    const after = analyseSolve(scrambled, extra)!;
    expect(after.turnsAfterSolution).toBe(1);
    expect(after.sliceTurns).toBe(37);
    expect(after.steps.at(-1)!.toMove).toBe(37);
  });

  it("returns null for a solve that does not finish solved", () => {
    expect(analyseSolve(scrambled, timed("R U"))).toBeNull();
    expect(analyseSolve(scrambled, [])).toBeNull();
  });
});
