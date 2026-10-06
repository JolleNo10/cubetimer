import type { SolveAnalysis } from "../../../../cube/analysis";
import { useController, useSettings } from "../../../../app/useController";
import type { CompareScope, ResultChart, ResultScatter } from "../../../../app/types";
import type { CaseSpreadRow, SolveComparison } from "../../../statistics/state/stats";
import { CaseSpread } from "./CaseSpread";
import { SolveDial } from "./SolveDial";
import { StepScatter } from "./StepScatter";
import { StepTrends } from "./StepTrends";

const CHARTS: [ResultChart, string][] = [["dial", "Dial"], ["scatter", "Scatter"], ["spread", "Spread"], ["trend", "Trend"]];
const SCATTERS: [ResultScatter, string, string][] = [
  ["recexec", "Recog vs exec", "Recognition against execution time"],
  ["speed", "Speed vs time", "Turning speed against execution time, with equal-move curves"],
  ["thinkturn", "Think vs turn", "Turning speed against recognition time"],
];

/** The chart beside the step breakdown, as the solver last chose it. */
export function ResultCharts({ analysis, comparison, spread, scope, loading, onScope }: {
  analysis: SolveAnalysis;
  comparison: SolveComparison | null;
  spread: CaseSpreadRow[] | null;
  scope: CompareScope;
  loading: boolean;
  onScope: (scope: CompareScope) => void;
}) {
  const controller = useController();
  const { resultChart: chart, resultScatter: scatter } = useSettings();
  const note = loading
    ? "loading history…"
    : comparison
      ? `usual = median of your last ${comparison.sampleSize} comparable solves`
      : "your usual appears after 3 comparable solves";

  return (
    <section className="result-charts" aria-label="Step charts">
      <div className="result-charts-head">
        <div className="result-charts-tabs" role="group" aria-label="Chart">
          {CHARTS.map(([value, label]) => (
            <button key={value} type="button" className="ghost small" aria-pressed={chart === value}
              onClick={() => void controller.updateSettings({ resultChart: value })}>{label}</button>
          ))}
        </div>
        <label className="result-charts-scope small">
          <span className="faint">Compare with</span>
          <select value={scope} onChange={(event) => onScope(event.target.value as CompareScope)}
            title="Saved for this session">
            <option value="session">this session</option>
            <option value="event">all sessions</option>
          </select>
        </label>
      </div>
      {chart === "scatter" ? (
        <div className="result-charts-tabs secondary" role="group" aria-label="Scatter view">
          {SCATTERS.map(([value, label, title]) => (
            <button key={value} type="button" className="ghost small" aria-pressed={scatter === value} title={title}
              onClick={() => void controller.updateSettings({ resultScatter: value })}>{label}</button>
          ))}
        </div>
      ) : null}
      {chart === "dial" ? <SolveDial analysis={analysis} />
        : chart === "scatter" ? <StepScatter steps={analysis.steps} comparison={comparison} mode={scatter} />
          : chart === "trend" ? <StepTrends steps={analysis.steps} comparison={comparison} />
            : <CaseSpread rows={spread} loading={loading} />}
      {chart === "scatter" || chart === "trend" ? <div className="result-charts-note small faint">{note}</div> : null}
    </section>
  );
}
