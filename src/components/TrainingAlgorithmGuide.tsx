import { useMemo } from "react";
import { expandedAlgorithmMoves, type TrainingGuideProgress } from "../cube/training";

export function TrainingAlgorithmGuide({ algorithm, guide, active }: {
  algorithm: string;
  guide: TrainingGuideProgress | null;
  active: boolean;
}) {
  const moves = useMemo(() => {
    if (guide) return guide.moves;
    try { return expandedAlgorithmMoves(algorithm); } catch { return [algorithm]; }
  }, [algorithm, guide?.moves]);
  const confirmed = active ? guide?.confirmed ?? 0 : 0;
  const current = active && guide && !guide.finished;
  return (
    <div className="training-algorithm-guide">
      <div className="training-algorithm-tokens mono" aria-label="Recommended algorithm">
        {moves.map((move, index) => (
          <span key={index} className={`training-algorithm-token ${index < confirmed ? "completed" : current && index === confirmed ? "current" : "upcoming"}`}
            aria-current={current && index === confirmed ? "step" : undefined}>{move}</span>
        ))}
      </div>
      {active && guide ? <div className="small dim training-algorithm-progress">
        {guide.finished ? `Guide complete · ${moves.length} moves` : `Move ${confirmed + 1} / ${moves.length}`}
        <span className="faint">Learning guide · any valid solution counts</span>
      </div> : null}
    </div>
  );
}
