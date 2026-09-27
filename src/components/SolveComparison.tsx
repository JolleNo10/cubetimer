import type { SolveComparison } from "../state/stats";
import { formatTime } from "../state/stats";

function formatDelta(deltaMs: number): string {
  return `${deltaMs >= 0 ? "+" : "-"}${formatTime(Math.abs(deltaMs))}s`;
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
            const direction = step.deltaMs < 0 ? "faster" : "slower";
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
                <span className={`solve-comparison-delta ${direction}`}>
                  {formatDelta(step.deltaMs)} {direction}
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
