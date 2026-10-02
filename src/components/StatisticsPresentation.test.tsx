import { Alg } from "cubing/alg";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { analyseSolve } from "../cube/analysis";
import { get3x3x3 } from "../cube/puzzle";
import { deriveStatistics } from "../state/statistics";
import { averageWindow } from "../state/stats";
import type { Solve } from "../state/types";
import { StatisticsSolveDetail } from "./StatisticsSolveDetail";
import { StatisticsAverageDetail, StatisticsRecords } from "./StatisticsRecords";
import { StatisticsAnalysisTables } from "./StatisticsAnalysisTables";
import { SolveResult } from "./SolveResult";
import { ControllerContext } from "../hooks/useController";
import { Controller } from "../state/controller";

const kpuzzle = await get3x3x3();
const alg = new Alg("R U R' U R U2 R'");
const moves = Array.from(alg.childAlgNodes()).map((node, index) => ({ move: node.toString(), t: (index + 1) * 300 }));
const solve: Solve = { id: "historical", sessionId: "history", createdAt: 1, rawMs: 2100, penalty: "+2", scramble: alg.invert().toString(), source: "smartcube", moves, comment: "Read-only note", analysis: analyseSolve(kpuzzle.defaultPattern().applyAlg(alg.invert()), moves) };
const sessions = [{ id: "history", name: "History Session", event: "333" as const, createdAt: 1 }];

describe("Statistics presentation", () => {
  it("renders a read-only historical solve with seven-step CFOP, metrics, and review actions", () => {
    const reviewed = { ...solve, inspectionMs: 12000 };
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={reviewed} solves={[reviewed]} session={sessions[0]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("4.10+"); expect(html).toContain("History Session");
    expect(html).toContain("Read-only note"); expect(html).toContain("STM"); expect(html).toContain("Whole-solve TPS");
    expect(html).toContain("Measured recognition"); expect(html).toContain("Execution"); expect(html).toContain("Pauses ≥250 ms");
    for (const phase of ["Cross", "F2L Slot 1", "F2L Slot 2", "F2L Slot 3", "F2L Slot 4", "OLL", "PLL"]) expect(html).toContain(phase);
    for (const column of ["Total", "Cumulative", "Recognition", "Execution", "Moves", "TPS"]) expect(html).toContain(column);
    expect(html).toContain("Raw time"); expect(html).toContain("2.10"); expect(html).toContain("Penalty"); expect(html).toContain("+2");
    expect(html).toContain("Smart cube"); expect(html).toContain("Inspection"); expect(html).toContain("12.00");
    expect(html).toContain(new Date(solve.createdAt).toLocaleString()); expect(html).toContain("R U2 R");
    expect(html).toContain("steps skipped");
    expect(html).toContain(">Replay<"); expect(html).toContain(">Tools<");
    expect(html).toContain("Cross planning before the first turn is not measured.");
    expect(html).not.toContain("<input"); expect(html).not.toContain("<textarea");
    for (const action of ["Delete", "Solve again", "Train", "Add a note"]) expect(html).not.toContain(action);
    expect(html).not.toMatch(/<button[^>]*>(?:OK|\+2|DNF)<\/button>/);
    expect(html).toMatch(/<button class="ghost">Tools<\/button>/);
    expect(html).toMatch(/<button class="ghost">Replay<\/button>/);
  });

  it("shows missing analysis without fabricated metrics", () => {
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={{ ...solve, analysis: null, moves: [] }} solves={[]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("No usable move-by-move CFOP analysis");
    expect(html).not.toContain("Whole-solve TPS");
    expect(html).toContain("disabled");
  });

  it("can review recorded CFOP analysis on a DNF average constituent", () => {
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={{ ...solve, penalty: "DNF" }} solves={[solve]} session={sessions[0]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("DNF(2.10)");
    expect(html).toContain("Measured recognition");
    expect(html).toContain("F2L Slot 4");
    expect(html).not.toContain("No usable move-by-move");
  });

  it("keeps a stored breakdown viewable without enabling raw-move tools", () => {
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={{ ...solve, moves: [], source: "import", penalty: "none" }} solves={[solve]} session={sessions[0]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Replay<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Tools<\/button>/);
    expect(html).toContain("F2L Slot 4"); expect(html).toContain("Measured recognition");
    expect(html).toContain(">OK<"); expect(html).toContain(">Import<");
  });

  it("shares comparison and post-solution information with normal Result, using same-Session history", () => {
    const reviewed = { ...solve, createdAt: 10, analysis: { ...solve.analysis!, turnsAfterSolution: 2, pauses: [] } };
    const history = [
      ...Array.from({ length: 3 }, (_, index) => ({ ...solve, id: `prior${index}`, createdAt: index })),
      ...Array.from({ length: 3 }, (_, index) => ({ ...solve, id: `other${index}`, sessionId: "other", createdAt: index + 3 })),
      reviewed,
    ];
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={reviewed} solves={history} session={sessions[0]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("median of last 3"); expect(html).not.toContain("median of last 6");
    expect(html).toContain("Compared with recent solves"); expect(html).toContain("2 turns after the cube was solved");
    const result = renderToStaticMarkup(<ControllerContext.Provider value={new Controller()}><SolveResult solve={reviewed} solves={history} onContinue={() => {}} onReplay={() => {}} onAnalyse={() => {}} onPracticeStep={() => {}} /></ControllerContext.Provider>);
    expect(result).toContain("median of last 3"); expect(result).toContain("2 turns after the cube was solved");
    for (const action of ["Delete", "Solve again", "Train", "Back to timer"]) expect(result).toContain(action);
    expect(result).toContain("<input"); expect(result).toMatch(/<button[^>]*>\+2<\/button>/);
  });

  it("explains discarded members and a retained DNF that makes the average DNF", () => {
    const solves = Array.from({ length: 5 }, (_, index) => ({ ...solve, id: `s${index}`, createdAt: index, rawMs: (index + 1) * 1000, penalty: index > 2 ? "DNF" as const : "none" as const }));
    const html = renderToStaticMarkup(<StatisticsAverageDetail window={averageWindow(solves, 5)!} solves={solves} sessions={sessions} onOpenSolve={() => {}} onClose={() => {}} />);
    expect(html).toContain("Ao5 · DNF"); expect(html).toContain("Discarded best"); expect(html).toContain("Discarded worst");
    expect(html).toContain("causes DNF average"); expect(html.match(/History Session/g)).toHaveLength(5);
    expect(html).toContain("1.00"); expect(html).toContain("DNF(4.00)");
  });

  it("renders all grouped record metrics, direction controls, PB history and Best splits", () => {
    const model = deriveStatistics({ sessions, solves: [solve] }, { event: "333", sessionId: null }, null);
    const html = renderToStaticMarkup(<StatisticsRecords model={model} onOpenSolve={() => {}} />);
    expect(html.match(/<option value=/g)).toHaveLength(27);
    for (const group of ["Solve", "Averages", "Phases", "Efficiency"]) expect(html).toContain(`label="${group}"`);
    expect(html).toContain("Fastest → slowest"); expect(html).toContain("Slowest → fastest");
    expect(html).toContain("PB history"); expect(html).toContain("Best splits"); expect(html).not.toContain("theoretical PB");
    expect(html).not.toContain("historical ·");
    expect(html).toContain("4.10+ · History Session");
  });

  it("renders sensible empty analysis and consistency sections", () => {
    const model = deriveStatistics({ sessions, solves: [] }, { event: "333", sessionId: null }, null);
    const html = renderToStaticMarkup(<StatisticsAnalysisTables model={model} onOpenSolve={() => {}} onTrainCase={() => {}} />);
    expect(html).toContain("No recognised non-skipped OLL cases"); expect(html).toContain("No recognised non-skipped PLL cases");
    expect(html).toContain("Pause analytics need usable CFOP analysis"); expect(html).toContain("P10 → P90");
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  });
});
