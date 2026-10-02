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

const kpuzzle = await get3x3x3();
const alg = new Alg("R U R' U R U2 R'");
const moves = Array.from(alg.childAlgNodes()).map((node, index) => ({ move: node.toString(), t: (index + 1) * 300 }));
const solve: Solve = { id: "historical", sessionId: "history", createdAt: 1, rawMs: 2100, penalty: "+2", scramble: alg.invert().toString(), source: "smartcube", moves, comment: "Read-only note", analysis: analyseSolve(kpuzzle.defaultPattern().applyAlg(alg.invert()), moves) };
const sessions = [{ id: "history", name: "History Session", event: "333" as const, createdAt: 1 }];

describe("Statistics presentation", () => {
  it("renders a read-only historical solve with seven-step CFOP, metrics, and review actions", () => {
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={solve} session={sessions[0]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("4.10+"); expect(html).toContain("History Session");
    expect(html).toContain("Read-only note"); expect(html).toContain("STM"); expect(html).toContain("Whole-solve TPS");
    expect(html).toContain("Measured recognition"); expect(html).toContain("Execution"); expect(html).toContain("Pauses ≥250 ms");
    expect(html).toContain("Cross"); expect(html).toContain("F2L Slot 4"); expect(html).toContain("OLL"); expect(html).toContain("PLL");
    expect(html).toContain(">Replay<"); expect(html).toContain(">Tools<");
    expect(html).toContain("Cross planning before the first turn is not measured.");
    expect(html).not.toContain("<input"); expect(html).not.toContain("<textarea");
    for (const action of ["Delete", "Solve again", "Train", "Add a note", "Penalty"]) expect(html).not.toContain(action);
  });

  it("shows missing analysis without fabricated metrics", () => {
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={{ ...solve, analysis: null, moves: [] }} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("No usable move-by-move CFOP analysis");
    expect(html).not.toContain("Whole-solve TPS");
    expect(html).toContain("disabled");
  });

  it("can review recorded CFOP analysis on a DNF average constituent", () => {
    const html = renderToStaticMarkup(<StatisticsSolveDetail solve={{ ...solve, penalty: "DNF" }} session={sessions[0]} onClose={() => {}} onReplay={() => {}} onTools={() => {}} />);
    expect(html).toContain("DNF(2.10)");
    expect(html).toContain("Measured recognition");
    expect(html).toContain("F2L Slot 4");
    expect(html).not.toContain("No usable move-by-move");
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
  });

  it("renders sensible empty analysis and consistency sections", () => {
    const model = deriveStatistics({ sessions, solves: [] }, { event: "333", sessionId: null }, null);
    const html = renderToStaticMarkup(<StatisticsAnalysisTables model={model} onOpenSolve={() => {}} onTrainCase={() => {}} />);
    expect(html).toContain("No recognised non-skipped OLL cases"); expect(html).toContain("No recognised non-skipped PLL cases");
    expect(html).toContain("Pause analytics need usable CFOP analysis"); expect(html).toContain("P10 → P90");
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  });
});
