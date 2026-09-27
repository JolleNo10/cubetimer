import type { SolveComparison } from "../state/stats";
import { formatTime } from "../state/stats";

export type ComparisonDelta = {
  text: string;
  direction: "faster" | "slower" | "same";
};

export function formatComparisonDelta(deltaMs: number): ComparisonDelta {
  const value = formatTime(Math.abs(deltaMs));
  if (value === "0.00") return { text: "0.00s", direction: "same" };

  return {
    text: `${deltaMs >= 0 ? "+" : "-"}${value}s`,
    direction: deltaMs > 0 ? "slower" : "faster",
  };
}

export function SolveComparisonPanel({ comparison }: { comparison: SolveComparison | null }) {
  return (
    <section className="solve-comparison" aria-label="Recent step comparison">
      <div className="solve-comparison-head">
        <span className="panel-title">Compared with recent solves</span>
        {comparison ? (
          <span className="small faint">median of last {comparison.sampleSize}</span>
        ) : null}
      </div>

      {comparison ? (
        <div className="solve-comparison-rows">
          {comparison.steps.map((step) => {
            const delta = formatComparisonDelta(step.deltaMs);
            return (
              <div className="solve-comparison-row" key={step.name}>
                <span className="solve-comparison-step">{step.name}</span>
                <span className="solve-comparison-value mono">
                  <span className="solve-comparison-label">this</span>
                  {formatTime(step.currentMs)}s
                </span>
                <span className="solve-comparison-value mono">
                  <span className="solve-comparison-label">recent</span>
                  {formatTime(step.baselineMs)}s
                </span>
                <span className={`solve-comparison-delta ${delta.direction}`}>
                  {delta.text} {delta.direction}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="solve-comparison-message">
          Complete 3 comparable analyzed solves to see step comparisons.
        </p>
      )}
    </section>
  );
}
