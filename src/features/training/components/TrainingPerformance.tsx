import { useMemo } from "react";
import { useController, useStore, useStoreValue } from "../../../app/useController";
import { formatTime } from "../../../shared/time";
import { concealsTrainingAnswer } from "../TrainingRuntime";
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
  const training = useStoreValue(controller.training.state, state => state);
  const identity = catalogueCaseForTarget(target);
  if (!identity || concealsTrainingAnswer(training)) return null;
  const stats = statsByCase.get(trainingCaseKey(identity)!) ?? EMPTY_TRAINING_CASE_STATS;
  const time = (value: number | null) => value === null ? "—" : formatTime(value);
  const delta = stats.recentMedianDelta;
  return <section className="training-personal-performance" aria-label="Personal Training performance">
    <div className="row wrap"><strong className="small">Personal performance</strong><span className="small dim">{statusText[stats.status]}</span></div>
    <dl className="training-personal-metrics">
      <div><dt>Attempts</dt><dd>{stats.attempts}</dd></div>
      <div><dt>Best move span</dt><dd>{time(stats.bestMoveSpanMs)}</dd></div>
      <div><dt>Recent move span</dt><dd>{time(stats.recentMedianMoveSpanMs)}</dd></div>
      {stats.bestCaseTimeMs !== null ? <><div><dt>Best drill case time</dt><dd>{time(stats.bestCaseTimeMs)}</dd></div>
        <div><dt>Recent drill case time</dt><dd>{time(stats.recentMedianCaseTimeMs)}</dd></div></> : null}
      <div><dt>Best STM</dt><dd>{stats.bestStm ?? "—"}</dd></div>
      <div><dt>Recent STM delta</dt><dd>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta} STM`}</dd></div>
    </dl>
    <p className="small dim">STM delta vs My algorithm when set, otherwise recommended.</p>
    {stats.recentMoveSpansMs.length ? <div className="small dim training-recent-times">
      Recent move spans: <span className="mono">{stats.recentMoveSpansMs.map(value => formatTime(value)).join(" · ")}</span>
    </div> : null}
  </section>;
}
