import { useMemo } from "react";
import { MoveSequence } from "../../../shared/ui/MoveSequence";
import { expandedAlgorithmMoves } from "../../../cube/frames";
import { type TrainingGuideProgress } from "../../../cube/training";

export type TrainingGuideNavigation = {
  previewIndex?: number | null;
  onPreviewStep?: (index: number | null) => void;
};

export function TrainingAlgorithmGuide({ algorithm, guide, active, label = "Recommended algorithm", previewIndex = null, onPreviewStep }: {
  algorithm: string;
  guide: TrainingGuideProgress | null;
  active: boolean;
  label?: string;
} & TrainingGuideNavigation) {
  const moves = useMemo(() => {
    if (guide) return guide.moves;
    try { return expandedAlgorithmMoves(algorithm); } catch { return [algorithm]; }
  }, [algorithm, guide?.moves]);
  const confirmed = active ? guide?.confirmed ?? 0 : 0;
  const current = Boolean(active && guide && !guide.finished && moves.length);
  const viewed = current ? previewIndex ?? confirmed : confirmed;
  const browsing = current && viewed !== confirmed;
  const selectStep = (index: number) => onPreviewStep?.(index === confirmed ? null : index);
  return (
    <div className="training-algorithm-guide">
      <MoveSequence moves={moves} currentIndex={current ? confirmed : null}
        completedCount={confirmed} selectedIndex={browsing ? viewed : null}
        onSelect={current ? selectStep : undefined} label={label} />
      {current ? <div className="training-algorithm-navigation" aria-label="Algorithm step navigation">
        <button type="button" className="ghost small" disabled={viewed === 0} onClick={() => selectStep(viewed - 1)}>Previous</button>
        <button type="button" className="ghost small" disabled={viewed === moves.length - 1} onClick={() => selectStep(viewed + 1)}>Next</button>
        {browsing ? <button type="button" className="ghost small" onClick={() => onPreviewStep?.(null)}>Follow current</button> : null}
      </div> : null}
      {active && guide ? <div className="small dim training-algorithm-progress">
        {guide.finished ? `Guide complete · ${moves.length} moves` : browsing ? `Viewing ${viewed + 1} / ${moves.length} · current ${confirmed + 1} / ${moves.length}` : `Move ${confirmed + 1} / ${moves.length}`}
        <span className="faint">Learning guide · any valid solution counts</span>
      </div> : null}
    </div>
  );
}
