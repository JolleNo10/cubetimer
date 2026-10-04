import { useMemo } from "react";
import { useController, useStore, useStoreValue } from "../../../app/useController";
import { formatTime } from "../../../shared/time";
import { catalogueCaseForTarget, EMPTY_TRAINING_CASE_STATS, trainingCaseKey, trainingStatsByCase, type TrainingCaseStats } from "../trainingPerformance";

const statusText = { new: "New", learning: "Learning", review: "Needs review", practiced: "Practised" };
export function trainingPerformanceLabel(stats?: TrainingCaseStats): string {
  return stats?.attempts ? `${stats.attempts} ${stats.attempts === 1 ? "attempt" : "attempts"}, ${statusText[stats.status].toLowerCase()}` : "";
}

/** Cards receive derived facts; they never subscribe independently. */
export function TrainingCaseMarker({ stats }: { stats?: TrainingCaseStats }) {
  if (!stats?.attempts) return null;
  return <span className={`training-case-marker ${stats.status}`} title={trainingPerformanceLabel(stats)}>
    {stats.attempts} · {statusText[stats.status]}
  </span>;
}

export function TrainingPersonalPerformance() {
  const controller = useController();
  const target = useStoreValue(controller.training.state, state => state.target);
  const attempts = useStore(controller.trainingAttempts);
  const statsByCase = useMemo(() => trainingStatsByCase(attempts), [attempts]);
  const identity = catalogueCaseForTarget(target);
  if (!identity) return null;
  const stats = statsByCase.get(trainingCaseKey(identity)!) ?? EMPTY_TRAINING_CASE_STATS;
  const time = (value: number | null) => value === null ? "—" : formatTime(value);
  const delta = stats.recentMedianDelta;
  return <section className="training-personal-performance" aria-label="Personal Training performance">
    <div className="row wrap"><strong className="small">Personal performance</strong><span className="small dim">{statusText[stats.status]}</span></div>
    <dl className="training-personal-metrics">
      <div><dt>Attempts</dt><dd>{stats.attempts}</dd></div>
      <div><dt>Best time</dt><dd>{time(stats.bestElapsedMs)}</dd></div>
      <div><dt>Recent median time</dt><dd>{time(stats.recentMedianElapsedMs)}</dd></div>
      <div><dt>Best STM</dt><dd>{stats.bestStm ?? "—"}</dd></div>
      <div><dt>Recent median delta</dt><dd>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta} STM`}</dd></div>
    </dl>
    {stats.recentElapsedMs.length ? <div className="small dim training-recent-times">
      Recent attempts: <span className="mono">{stats.recentElapsedMs.map(value => formatTime(value)).join(" · ")}</span>
    </div> : null}
  </section>;
}
