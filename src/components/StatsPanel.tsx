import { useMemo } from "react";
import { formatTime, sessionStats } from "../state/stats";
import type { Solve } from "../state/types";

export function StatsPanel({ solves }: { solves: Solve[] }) {
  const stats = useMemo(() => sessionStats(solves), [solves]);

  const cells: { label: string; value: string; sub?: string }[] = [
    { label: "solves", value: String(stats.count), sub: `${stats.solved} finished` },
    { label: "best", value: formatTime(stats.best) },
    { label: "ao5", value: formatTime(stats.ao5), sub: labelBest(stats.bestAo5) },
    { label: "ao12", value: formatTime(stats.ao12), sub: labelBest(stats.bestAo12) },
    { label: "ao50", value: formatTime(stats.ao50) },
    { label: "ao100", value: formatTime(stats.ao100) },
    { label: "session mean", value: formatTime(stats.mean) },
    {
      label: "avg moves",
      value: stats.averageMoves ? stats.averageMoves.toFixed(1) : "—",
      sub: stats.averageTps ? `${stats.averageTps.toFixed(2)} tps` : undefined,
    },
  ];

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Statistics</span>
      </div>
      <div className="panel-body">
        <div className="stat-grid">
          {cells.map((cell) => (
            <div className="stat" key={cell.label}>
              <span className="label">{cell.label}</span>
              <span className="value">{cell.value}</span>
              {cell.sub ? <span className="sub">{cell.sub}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function labelBest(best: number | undefined): string | undefined {
  return best === undefined ? undefined : `best ${formatTime(best)}`;
}
