import type { Solve } from "../../../app/types";
import { formatTime } from "../../../shared/time";

export function SolveOutlierNotice({ solve }: { solve: Solve }) {
  const outlier = solve.statisticsOutlier;
  if (!outlier) return null;
  const label = outlier.action === "exclude" ? "auto slow - not counted" : "auto slow - counts as DNF";
  return <span className="phase-case muted" title={`Above ${outlier.multiplier} times the recent session median (${formatTime(outlier.baselineMs)}s). Change the threshold in Settings to reconsider this solve.`}>{label}</span>;
}
