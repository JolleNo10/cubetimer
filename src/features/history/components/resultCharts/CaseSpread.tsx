import type { CaseSpreadRow } from "../../../statistics/state/stats";
import { seconds, shortStep, stepColour } from "./chartParts";

const W = 420;
const ROW = 30;
const LEFT = 104;
const RIGHT = 92;

/**
 * Each step against every earlier time for the same case, fast to slow, so a slow case
 * can be told apart from being slow at it this time.
 */
export function CaseSpread({ rows, loading }: { rows: CaseSpreadRow[] | null; loading: boolean }) {
  if (loading) return <div className="rc-empty small faint">Loading your history…</div>;
  if (!rows) return <div className="rc-empty small faint">No breakdown to compare.</div>;
  const height = rows.length * ROW + 22;

  return (
    <div className="rc-spread">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Each step against your earlier times for the same case">
        <text x={LEFT} y={11} className="rc-axis">FAST</text>
        <text x={W - RIGHT} y={11} textAnchor="end" className="rc-axis">SLOW</text>
        {rows.map((row, index) => {
          const cy = 30 + index * ROW;
          const values = row.skipped ? row.samples : [...row.samples, row.currentMs];
          const low = Math.min(...values), high = Math.max(...values);
          const x = (ms: number) => LEFT + (high > low ? (ms - low) / (high - low) : 0.5) * (W - LEFT - RIGHT);
          const share = row.fasterThan === null ? null : Math.round(row.fasterThan * 100);
          return (
            <g key={row.name}>
              <title>{row.skipped
                ? `${row.name}: skipped`
                : `${row.name} · ${row.label}: ${seconds(row.currentMs)}s${row.samples.length
                  ? `, faster than ${share}% of ${row.samples.length} earlier (median ${seconds(row.medianMs)}s)`
                  : ", no earlier times for this case"}`}</title>
              <text x={0} y={cy + 4} className="rc-label">{shortStep(row.name)}</text>
              <text x={38} y={cy + 4} className="rc-axis">{row.label}</text>
              <line x1={LEFT} x2={W - RIGHT} y1={cy} y2={cy} className="rc-grid" />
              {row.samples.map((ms, i) => (
                <circle key={i} cx={x(ms)} cy={cy + ((i * 37) % 11) - 5} r={2.6} className="rc-sample" />
              ))}
              {row.medianMs !== null ? <line x1={x(row.medianMs)} x2={x(row.medianMs)} y1={cy - 10} y2={cy + 10} className="rc-median-tick" /> : null}
              {!row.skipped ? <circle cx={x(row.currentMs)} cy={cy} r={6.5} fill={stepColour(row.name)} className="rc-dot" /> : null}
              <text x={W - RIGHT + 10} y={cy + 4} className="rc-label mono">{row.skipped ? "skip" : seconds(row.currentMs)}</text>
              <text x={W - RIGHT + 44} y={cy + 4} className="rc-axis">
                {row.skipped ? "" : share === null ? "first time" : `beat ${share}%`}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="rc-key small faint">dots = earlier times for this case · tick = their median · big dot = this solve</div>
    </div>
  );
}
