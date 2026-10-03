import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrendPoint } from "../state/statistics";
import { AverageProgressionChart, RecognitionExecutionTrendChart, CfopPhaseTrendChart, DistributionChart, SolveTimeTrendChart } from "./StatisticsCharts";

describe("Statistics charts", () => {
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
      <AverageProgressionChart scopeLabel="A" points={points.map((point) => ({ index: point.index, solveId: point.id, createdAt: point.createdAt, ao5: point.time }))} />,
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
      { index: 5, solveId: "s5", createdAt: 5, ao5: 10000 },
      { index: 6, solveId: "s6", createdAt: 6, ao5: null },
      { index: 50, solveId: "s50", createdAt: 50, ao5: 9000, ao12: 11000, ao50: 12000 },
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
});
