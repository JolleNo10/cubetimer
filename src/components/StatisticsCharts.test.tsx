import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrendPoint } from "../state/statistics";
import { DistributionChart, SolveTimeTrendChart } from "./StatisticsCharts";

describe("Statistics charts", () => {
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
