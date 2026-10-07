import { formatTime } from "../../../shared/time";
import { useMemo } from "react";
import { sessionStats, type LongAverage } from "../state/stats";
import type { Solve } from "../../../app/types";

export function StatsPanel({ solves, onOpenStatistics }: { solves: Solve[]; onOpenStatistics?: (view: "Solves") => void }) {
  const stats = useMemo(() => sessionStats(solves), [solves]);

  const openSolves = onOpenStatistics ? () => onOpenStatistics("Solves") : undefined;
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Statistics</span>
        <button type="button" className="ghost small stats-count-link" title="Selected session; slow / replay excluded" onClick={openSolves} aria-label="View counted solves">{stats.count} counted</button>
      </div>
      <div className="panel-body">
        <div className="stats-sections">
          <section className="stats-current" aria-label="Current averages">
            <h3 className="stats-section-title">Current</h3>
            <div className="stat-grid">
              <Stat onOpen={openSolves} label="Ao5" value={formatTime(stats.ao5)} sub={labelBest(stats.bestAo5)} />
              <Stat onOpen={openSolves} label="Ao12" value={formatTime(stats.ao12)} sub={labelBest(stats.bestAo12)} />
            </div>
          </section>
          <section aria-label="Overall session performance">
            <h3 className="stats-section-title">Overall</h3>
            <div className="stat-grid">
              <Stat label="Best" value={formatTime(stats.best)} />
              <Stat label="Mean" value={formatTime(stats.mean)} />
            </div>
          </section>
          <section aria-label="Long averages">
            <h3 className="stats-section-title">Long averages</h3>
            <div className="stat-grid">
              <Stat onOpen={openSolves} label="Ao50" value={formatTime(stats.ao50.value)} sub={longAverageLabel(stats.ao50)} />
              <Stat onOpen={openSolves} label="Ao100" value={formatTime(stats.ao100.value)} sub={longAverageLabel(stats.ao100)} />
            </div>
          </section>
          {stats.solving && (
            <section aria-label="Analysed session solving metrics">
              <h3 className="stats-section-title">Solving</h3>
              <dl className="stats-solving">
                <div><dt>Moves</dt><dd>{stats.solving.meanMoves.toFixed(1)}</dd></div>
                <div><dt>TPS</dt><dd>{stats.solving.aggregateTps.toFixed(2)}</dd></div>
                <div><dt>Recognition</dt><dd>{formatTime(stats.solving.meanRecognitionMs)}<span className="stats-unit">s</span></dd></div>
              </dl>
            </section>
          )}
          {stats.cfop && (
            <section aria-label="CFOP session median">
              <h3 className="stats-section-title">CFOP · session median</h3>
              <dl className="stats-cfop">
                {stats.cfop.map((phase) => (
                  <div key={phase.name}>
                    <dt>{phase.name}</dt>
                    <dd>{formatTime(phase.timeMs)}<span className="stats-unit">s</span></dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, onOpen }: { label: string; value: string; sub?: string; onOpen?: () => void }) {
  const content = <><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="sub">{sub}</span>}</>;
  return onOpen ? <button type="button" className="stat stats-shortcut" onClick={onOpen} aria-label={`View ${label} solve history`}>{content}</button>
    : <div className="stat">{content}</div>;
}

function longAverageLabel(average: LongAverage): string {
  if (average.status === "unavailable") return "needs 10 solves";
  if (average.status === "projected") {
    const remaining = average.size - average.count;
    return `Projected average · ${average.count} / ${average.size} solves · ${remaining} remaining`;
  }
  return "actual";
}

function labelBest(best: number | undefined): string | undefined {
  return best === undefined ? undefined : `best ${formatTime(best)}`;
}
