import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import { ANALYSIS_VERSION, analyseSolve, inferInsertionPosition, type TimedMove } from "./analysis";
import { IDENTITY, rotationForCrossFace } from "./orientation";
import { physicalTurns } from "./physicalTurns";
import { f2lExecution } from "./stepExecution";
import type { Face } from "./moves";
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
    // Every F2L trigger here is a catalogue algorithm that opens with its own U, so the
    // U is execution, not lining up: recognition ends with the first move, 200 ms in.
    expect(byName["F2L Slot 2"].recognitionMs).toBe(200);
    expect(byName["F2L Slot 2"].executedAlg?.alg).toBeDefined();
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
  });

  it("names the F2L case each pair started as", () => {
    // Every pair goes back in with U R U' R' in its own slot's frame: textbook case 1.
    expect(
      ["F2L Slot 1", "F2L Slot 2", "F2L Slot 3", "F2L Slot 4"].map((n) => byName[n].case),
    ).toEqual(["F2L 1", "F2L 1", "F2L 1", "F2L 1"]);
  });

  it("infers that every pair was inserted at front-right when each used U R U' R' in its own frame", () => {
    // Slots are filled FR, BR, BL, FL in the cube's frame, but every pair was rotated to the
    // front-right first: the turns are U R U' R', U B U' B', U L U' L' and U F U' F'.
    const f2l = analysis.steps.slice(1, 5);
    expect(f2l.map((step) => step.insertedAt)).toEqual(["FR", "FR", "FR", "FR"]);
    expect(f2l.every((step) => step.insertedAtSource === "inferred")).toBe(true);
    expect(byName["Cross"].insertedAt).toBeUndefined();
    expect(byName["OLL"].insertedAt).toBeUndefined();
  });

  it("infers front-left for left-handed inserts", () => {
    // Mirror images of the fixture: U' L' U L in each slot's own front-left frame.
    const lefty = ["F' U' F U", "L' U' L U", "B' U' B U", "R' U' R U"]; // open FR, FL, BL, BR
    const start = kpuzzle.defaultPattern().applyAlg(new Alg(pll).invert()).applyAlg(new Alg(oll).invert()).applyAlg(new Alg(lefty.join(" ")));
    const forward = [...lefty].reverse().map((e) => new Alg(e).invert().toString()).join(" ") + " " + oll + " " + pll;
    const mirrored = analyseSolve(start, timed(forward))!;
    expect(mirrored.steps.slice(1, 5).map((step) => step.insertedAt)).toEqual(["FL", "FL", "FL", "FL"]);
  });

  it("uses the recorded grip for the exact insertion position", () => {
    // Held exactly as scrambled the whole time, so each pair went in where its slot is.
    const held = analyseSolve(scrambled, timed(solution), { orientations: timed(solution).map(() => IDENTITY), inspection: [] })!;
    expect(held.steps.slice(1, 5).map((step) => [step.insertedAt, step.insertedAtSource])).toEqual([["FR", "grip"], ["BR", "grip"], ["BL", "grip"], ["FL", "grip"]]);
  });

  it("breaks a tie with the slot face turned last and leaves untouched slots unknown", () => {
    expect(inferInsertionPosition("FR", ["F", "R", "U", "R'", "U'", "F'"])).toBe("FL");
    expect(inferInsertionPosition("FR", ["F'", "U", "F", "R", "U", "R'"])).toBe("FR");
    expect(inferInsertionPosition("FR", ["U", "D", "U'"])).toBeNull();
    expect(inferInsertionPosition("FR", ["U", "R", "U'", "R'"])).toBe("FR");
    expect(inferInsertionPosition("FR", ["U'", "F'", "U", "F"])).toBe("FL");
    expect(inferInsertionPosition("UR", ["R"])).toBeNull();
    expect(inferInsertionPosition(null, ["R"])).toBeNull();
  });

  it("stamps the analysis with the version that made it", () => {
    expect(analysis.analysisVersion).toBe(ANALYSIS_VERSION);
  });

  it("does not call a pair a case when it was already solved", () => {
    // Only three slots are opened, so the FL pair is never one of the 41 cases.
    const partial = kpuzzle.defaultPattern()
      .applyAlg(new Alg(pll).invert()).applyAlg(new Alg(oll).invert())
      .applyAlg(new Alg(extractions.slice(1).join(" ")));
    const forward = [...extractions.slice(1)].reverse().map((e) => new Alg(e).invert().toString()).join(" ") +
      " " + oll + " " + pll;
    const result = analyseSolve(partial, timed(forward))!;
    const cases = result.steps.slice(1, 5).map((step) => step.case);
    expect(cases.filter((value) => value === "F2L 1")).toHaveLength(3);
    expect(cases).toContain(null);
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

describe("analyseSolve on the solves that used to be misread", () => {
  /** Run a solution, held cross-down, from the state it solves. `pauses` are move indices preceded by a long think. */
  function solveOf(solution: string, { face = "D" as Face, pauses = [] as number[] } = {}) {
    const { moves } = physicalTurns(solution, rotationForCrossFace(face).orientation);
    let t = 0;
    const timedMoves = moves.map((move, i) => ({ move, t: (t += pauses.includes(i) ? 1200 : 150) }));
    const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(moves.join(" ")).invert());
    return analyseSolve(scrambled, timedMoves)!;
  }
  const step = (analysis: ReturnType<typeof solveOf>, name: string) => analysis.steps.find((s) => s.name === name)!;
  const PAIRS = new Alg("R U R' U' L' U' L U L U L' U' R' U' R U").invert().toString();

  it("dates a cross by when it was rebuilt, not by an accidental early one", () => {
    // The cross is in place at the start, knocked out by a D for nine moves, then put back.
    const analysis = solveOf(`D R U R' U' R U R' U' D' ${PAIRS}`);
    expect(analysis.crossFace).toBe("D");
    expect(step(analysis, "Cross").toMove).toBe(10);
    expect(step(analysis, "Cross").skipped).toBe(false);
  });

  it("does not take a last-layer coincidence on another face for the cross", () => {
    // One move after the last pair the cube is a single turn from an F2L on B.
    const analysis = solveOf(`${PAIRS} U R U2 R' U' R U2 L' U R' U' L`);
    expect(analysis.crossFace).toBe("D");
    expect(step(analysis, "PLL").case).toBe("Jb");
  });

  it("finds the cross face of a solve that skipped the whole last layer", () => {
    const analysis = solveOf(PAIRS, { face: "L" });
    expect(analysis.crossFace).toBe("L");
    expect(step(analysis, "OLL").case).toBe("Solved");
    expect(step(analysis, "PLL").case).toBe("Solved");
  });

  it("credits a pair knocked out and rebuilt to the rebuild", () => {
    const rebuilt = solveOf(`U R U' R' R U R' U' ${new Alg("L U L' U' R' U' R U").invert()} U R U' R'`);
    const last = step(rebuilt, "F2L Slot 4");
    expect(last.slot).toBe("FR");
    expect(last.toMove).toBe(20);
  });

  it("calls pairs that went in with the cross an xcross, not skips", () => {
    // F2 restores the front cross edge and both front pairs at once.
    const analysis = solveOf(`F2 ${new Alg("L U L' U' R' U' R U").invert()}`);
    expect(step(analysis, "Cross").toMove).toBe(1);
    const during = analysis.steps.filter((s) => s.solvedDuring === "Cross").map((s) => s.slot);
    expect(during.sort()).toEqual(["FL", "FR"]);
    expect(analysis.stepsSkipped).toBe(2); // the last layer, not the pairs
  });

  it("splits a two-look OLL into its looks", () => {
    const analysis = solveOf(`${PAIRS} F R U R' U' F' U R U R' U R U2 R'`, { pauses: [22] });
    const oll = step(analysis, "OLL");
    expect(oll.looks?.map((look) => [look.kind, look.label])).toEqual([["edges", "I-Shape"], ["corners", "Sune"]]);
    // The think before the second look, and the U that lines it up.
    expect(oll.looks![1].recognitionMs).toBe(1350);
    expect(oll.recognitionMs).toBe(oll.looks!.reduce((sum, look) => sum + look.recognitionMs, 0));
  });

  it("splits a two-look PLL into its looks", () => {
    const analysis = solveOf(`${PAIRS} R U R' U' R' F R2 U' R' U' R U R' F' U R U' R U R U R U' R' U' R2`);
    const pll = step(analysis, "PLL");
    expect(pll.looks?.map((look) => look.kind)).toEqual(["corners", "edges"]);
    expect(pll.looks![0].label).toBe("Headlights");
    expect(["Ua", "Ub"]).toContain(pll.looks![1].label);
  });

  it("keeps a one-look algorithm as one look", () => {
    const analysis = solveOf(`${PAIRS} U R U R' U' R' F R2 U' R' U' R U R' F'`);
    const pll = step(analysis, "PLL");
    expect(pll.looks).toHaveLength(1);
    expect(pll.looks![0].kind).toBe("full");
    expect(pll.executedAlg?.family).toBe("PLL");
  });

  it("reads an F2L case where its algorithm began, after turns that set it up", () => {
    const tokens = physicalTurns("L' U L U R U' R'").moves;
    const patterns = [kpuzzle.defaultPattern().applyAlg(new Alg(tokens.join(" ")).invert())];
    for (const move of tokens) patterns.push(patterns.at(-1)!.applyMove(move));
    const execution = f2lExecution({
      kpuzzle,
      facing: (index) => patterns[index],
      tokens,
      moves: timed(tokens.join(" "), 150),
      from: 0,
      to: tokens.length,
      startMs: 0,
    }, "FR");
    expect(execution.case).toBe("F2L 1");
    expect(execution.caseAt).toBe(3);
    expect(execution.setupMoves).toBe(2);
    expect(execution.recognitionMs).toBe(150);
  });
});
