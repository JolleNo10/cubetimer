import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrendPoint } from "../state/statistics";
import { deriveStatistics } from "../state/statistics";
import type { Solve } from "../state/types";
import { AverageProgressionChart, RecognitionExecutionTrendChart, CfopPhaseTrendChart, DistributionChart, SolveTimeTrendChart } from "./StatisticsCharts";

describe("Statistics charts", () => {
  it("does not bridge a Session whose solves disappear from the derived average progression", () => {
    const solves: Solve[] = ["A", "A", "A", "A", "A", "B", "B", "B", "B", "A"].map((sessionId, index) => ({
      id: `s${index}`, sessionId, createdAt: index, rawMs: 10_000 + index * 100,
      penalty: "none", scramble: "", source: "keyboard", moves: [],
    }));
    const model = deriveStatistics({
      sessions: ["A", "B"].map((id) => ({ id, name: id, event: "333", createdAt: 0 })), solves,
    }, { event: "333", sessionId: null }, null);
    expect(model.averageProgression.map((point) => point.sessionId)).toEqual(["A", "A"]);
    const html = renderToStaticMarkup(<AverageProgressionChart points={model.averageProgression} scopeLabel="All sessions" />);
    const path = /class="chart-line ao5" d="([^"]*)"/.exec(html)![1];
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain("L");
  });

  it("breaks every average path at Session transitions, including a returning Session", () => {
    const points = ["A", "A", "B", "B", "A"].map((sessionId, index) => ({
      index, id: `s${index}`, sessionId, createdAt: index, time: 14000 + index * 100,
      ao5: 15000 + index * 100, ao12: 16000 + index * 100, isPb: false,
    }));
    const solveTime = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="All sessions" />);
    const progression = renderToStaticMarkup(<AverageProgressionChart scopeLabel="All sessions" points={points.map((point) => ({
      ...point, solveId: point.id, segmentKey: String(Math.floor(point.index / 2)), ao50: point.ao5 + 2000, ao100: point.ao5 + 3000,
    }))} />);
    for (const [html, metrics] of [[solveTime, [5, 12]], [progression, [5, 12, 50, 100]]] as const) {
      for (const size of metrics) {
        const path = new RegExp(`class="chart-line ao${size}" d="([^"]*)"`).exec(html)![1];
        expect(path.match(/M/g), `Ao${size}`).toHaveLength(3);
        expect(path.match(/L/g), `Ao${size}`).toHaveLength(2);
      }
    }
    expect(solveTime.match(/class="chart-session-boundary"/g)).toHaveLength(2);
    expect(solveTime.match(/class="chart-point"/g)).toHaveLength(5);
    expect(progression.match(/class="chart-series-point ao/g)).toHaveLength(20);
    for (const point of points) for (const size of [5, 12, 50, 100]) expect(progression).toContain(`${point.id} \u00b7 Ao${size}:`);
  });

  it("omits nonfinite singles and averages without emitting invalid coordinates", () => {
    const points = [15000, NaN, Infinity].map((time, index) => ({ index, id: `s${index}`, sessionId: "A", createdAt: index, time, ao5: time, ao12: time, isPb: false }));
    const html = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="A" />);
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
    expect(html.match(/class="chart-point"/g)).toHaveLength(1);
  });

  it("uses a padded nonzero domain and matching axis labels for narrow solve ranges", () => {
    const points = [13500, 15000, 16500].map((time, index) => ({ index, id: `s${index}`, sessionId: "A", createdAt: index, time, ao5: undefined, ao12: undefined, isPb: false }));
    const html = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="A" />);
    expect(html).toContain('data-y-min="13260"');
    expect(html).toContain('data-y-max="16740"');
    expect(html).toContain('text-anchor="end">13.26</text>');
    expect(html).toContain('text-anchor="end">16.74</text>');
    const ys = [...html.matchAll(/<circle[^>]*cy="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(200);
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  });

  it.each([[15000], [15000, 15000, 15000]])("renders constant and one-point time series safely: %j", (...values) => {
    const points = values.map((time, index) => ({ index, id: `s${index}`, sessionId: "A", createdAt: index, time, ao5: time, ao12: undefined, isPb: false }));
    const charts = [
      <SolveTimeTrendChart points={points} scopeLabel="A" />,
      <AverageProgressionChart scopeLabel="A" points={points.map((point) => ({ index: point.index, solveId: point.id, sessionId: point.sessionId, segmentKey: "0", createdAt: point.createdAt, ao5: point.time }))} />,
      <RecognitionExecutionTrendChart scopeLabel="A" points={points.map((point) => ({ index: point.index, solveId: point.id, recognitionMs: point.time, executionMs: point.time, unclassifiedMs: point.time }))} />,
      <CfopPhaseTrendChart scopeLabel="A" points={points.map((point) => ({ index: point.index, solveId: point.id, createdAt: point.createdAt, sessionId: "A", crossMs: point.time, f2lMs: point.time, ollMs: point.time, pllMs: point.time }))} />,
    ];
    for (const chart of charts) {
      const html = renderToStaticMarkup(chart);
      expect(html).toContain('data-y-min="14250"');
      expect(html).toContain('data-y-max="15750"');
      expect(html).toContain('text-anchor="end">14.25</text>');
      expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
      expect(html).toMatch(/(?:cy="143"|M64\.0,143\.0)/);
    }
  });

  it("charts actual rolling averages with unavailable or DNF windows left as gaps", () => {
    const html = renderToStaticMarkup(<AverageProgressionChart scopeLabel="All sessions" points={[
      { index: 5, solveId: "s5", sessionId: "A", segmentKey: "0", createdAt: 5, ao5: 10000 },
      { index: 6, solveId: "s6", sessionId: "A", segmentKey: "0", createdAt: 6, ao5: null },
      { index: 50, solveId: "s50", sessionId: "A", segmentKey: "0", createdAt: 50, ao5: 9000, ao12: 11000, ao50: 12000 },
    ]} />);
    expect(html).toContain("Actual rolling average progression");
    expect(html).toContain("s50 · Ao50: 12.00"); expect(html).not.toContain("Projected");
    expect(html).toContain('class="chart-line ao100" d=""');
    expect(html).toMatch(/class="chart-line ao5" d="M[^L]+ M/);
    expect(renderToStaticMarkup(<AverageProgressionChart scopeLabel="All sessions" points={[]} />)).toContain("actual window of at least 5");
  });

  it("renders measured recognition/execution series with their source solve IDs", () => {
    const html = renderToStaticMarkup(<RecognitionExecutionTrendChart scopeLabel="Session A" points={[{ index: 1, solveId: "historical", recognitionMs: 2000, executionMs: 7500, unclassifiedMs: 500 }]} />);
    expect(html).toContain("Measured recognition / execution trend for Session A");
    expect(html).toContain("historical · Measured recognition: 2.00"); expect(html).toContain("historical · Measured execution: 7.50");
    expect(html).toContain("historical · Unclassified/opening time: 0.50");
  });

  it("distinguishes an empty CFOP scope from an empty display window", () => {
    const scope = renderToStaticMarkup(<CfopPhaseTrendChart points={[]} scopeLabel="All sessions" />);
    expect(scope).toContain("No usable CFOP analysis in this scope.");

    const window = renderToStaticMarkup(<CfopPhaseTrendChart points={[]} scopeLabel="All sessions" emptyMessage="No analysed solves in this chart window." />);
    expect(window).toContain("No analysed solves in this chart window.");
    expect(window).not.toContain("No usable CFOP analysis in this scope.");

    const all = renderToStaticMarkup(<CfopPhaseTrendChart points={[{
      index: 1, solveId: "old", sessionId: "A", createdAt: 1,
      crossMs: 1_000, f2lMs: 5_000, ollMs: 2_000, pllMs: 2_000,
    }]} scopeLabel="All sessions" emptyMessage="No analysed solves in this chart window." />);
    expect(all).toContain('aria-label="CFOP phase trend for All sessions"');
    expect(all).not.toContain("No analysed solves");
  });

  it("centres the median and single-value label in a constant-time distribution", () => {
    const markup = renderToStaticMarkup(<DistributionChart distribution={{
      status: "ready",
      bins: [{ startMs: 10_000, endMs: 10_000, count: 3 }],
      minMs: 10_000,
      maxMs: 10_000,
      medianMs: 10_000,
      dnfCount: 0,
    }} />);
    const bar = /<rect class="histogram-bar"[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/.exec(markup)!;
    const marker = /<line class="chart-median"[^>]*x1="([\d.]+)"[^>]*x2="([\d.]+)"/.exec(markup)!;
    const centre = Number(bar[1]) + Number(bar[2]) / 2;
    expect(Number(marker[1])).toBe(centre);
    expect(Number(marker[2])).toBe(centre);
    expect(markup).toContain(`<text class="chart-axis" x="${centre}" y="284" text-anchor="middle">10.00</text>`);
    expect(markup).toContain("10.00: 3 solves");
    expect(markup).not.toContain("10.00–10.00");
  });

  it("assigns theme classes to singles, PBs, clipped outliers and DNFs with explicit outlier precedence", () => {
    const points: TrendPoint[] = Array.from({ length: 25 }, (_, index) => ({
      index: index + 1,
      id: `solve-${index}`,
      sessionId: "A",
      createdAt: index,
      time: index === 0 ? 1_000_000 : index === 24 ? null : 10_000,
      ao5: undefined,
      ao12: undefined,
      isPb: index === 0 || index === 1,
    }));
    const markup = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="All sessions" />);
    expect(markup).toContain('<g class="chart-point outlier"><title>solve-0:');
    expect(markup).toContain('<g class="chart-point pb"><title>solve-1:');
    expect(markup).toContain('<g class="chart-point"><title>solve-2:');
    expect(markup).toContain('<g class="chart-dnf"');
    expect(markup).not.toContain('class="chart-point pb outlier"');
    expect(markup.match(/<g class="chart-axis"><line /g)).toHaveLength(3);
  });

  it("clips an extreme fast Single while preserving the useful range and real accessible time", () => {
    const points = [100, ...Array.from({ length: 24 }, (_, index) => 14000 + index % 3 * 1000)].map((time, index) => ({
      index, id: `s${index}`, sessionId: "A", createdAt: index, time, isPb: index === 0, ao5: undefined, ao12: undefined,
    }));
    const html = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="A" onOpenSolve={() => {}} />);
    expect(Number(/data-y-min="([\d.]+)"/.exec(html)![1])).toBeGreaterThan(13000);
    expect(Number(/data-y-max="([\d.]+)"/.exec(html)![1])).toBeLessThan(17000);
    const marker = /<g class="chart-point outlier outlier-low"[^>]*>[\s\S]*?<\/g>/.exec(html)![0];
    expect(marker).toContain('<title>s0: 0.10');
    expect(marker).toContain('aria-label="View solve 0.10');
    expect(marker).toContain('role="button"');
    expect(marker).toContain('tabindex="0"');
    expect(marker).toContain('M64,266 l7,-9 h-14 z');
    const ys = [...html.matchAll(/<circle[^>]*cy="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(200);
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
    expect(points[0].time).toBe(100);
  });

  it("uses the real finite Single range below 20 samples", () => {
    const points = [100, ...Array(18).fill(15000), NaN, Infinity].map((time, index) => ({
      index, id: `s${index}`, sessionId: "A", createdAt: index, time, isPb: false, ao5: undefined, ao12: undefined,
    }));
    const html = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="A" />);
    expect(html).toContain('data-y-min="0"');
    expect(html).not.toContain('outlier-low');
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  });

  it("includes every visible rolling average in the domain beyond Single percentile bounds", () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      index, id: `s${index}`, sessionId: "A", createdAt: index, time: 15000, isPb: false, ao5: 5000, ao12: 25000,
    }));
    const html = renderToStaticMarkup(<SolveTimeTrendChart points={points} scopeLabel="A" />);
    expect(Number(/data-y-min="([\d.]+)"/.exec(html)![1])).toBeLessThan(5000);
    expect(Number(/data-y-max="([\d.]+)"/.exec(html)![1])).toBeGreaterThan(25000);
    expect(html).not.toContain("NaN"); expect(html).not.toContain("Infinity");
  });
});
