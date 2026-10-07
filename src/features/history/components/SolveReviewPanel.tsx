import { isUsableCfopAnalysis } from "../../../app/solveAnalysis";
import { useEffect, useState } from "react";
import { formatTime } from "../../../shared/time";
import { GripLabel } from "../../../shared/ui/GripLabel";
import { get3x3x3 } from "../../../cube/puzzle";
import { MAX_SEARCH_DEPTH } from "../../../cube/optimise";
import { F2L_POSITIONS, f2lPositionLabel, type F2lPosition } from "../../../cube/f2lCases";
import { slotInHeldFrame, rotationForCrossFace } from "../../../cube/orientation";
import {
  analyseSolveAlternatives,
  type Alternative,
  type SolveAlternatives,
  type StepAlternatives,
} from "../../../cube/alternatives";
import type { SolveAnalysis, SolveStep } from "../../../cube/analysis";
import { startingPattern } from "../repair";
import type { Solve } from "../../../app/types";

/** An alternative to play on the replay cube, from the state it starts at. */
export type ReviewPreview = {
  label: string;
  fromMove: number;
  /** Face turns of the cube's own frame. */
  cubeMoves: string[];
  /** The algorithm as written, cross-down, rotations and wide moves included. */
  alg?: string;
};

type Load = { result: SolveAlternatives | null; done: number; total: number; failed: string | null };

/** The alternatives for a solve, worked out once the panel is shown and streamed in as they come. */
function useAlternatives(solve: Solve, analysis: SolveAnalysis): Load {
  const [load, setLoad] = useState<Load>({ result: null, done: 0, total: analysis.steps.length + 3, failed: null });
  useEffect(() => {
    if (!isUsableCfopAnalysis(solve)) return;
    let cancelled = false;
    void (async () => {
      try {
        const kpuzzle = await get3x3x3();
        const scrambled = startingPattern(kpuzzle, solve);
        if (!scrambled) throw new Error("This solve's starting state is not known.");
        await analyseSolveAlternatives(kpuzzle, { analysis, moves: solve.moves, scrambled }, (partial, done, total) => {
          if (!cancelled) setLoad({ result: { ...partial, steps: [...partial.steps] }, done, total, failed: null });
        });
      } catch (error) {
        if (!cancelled) setLoad((current) => ({ ...current, failed: String(error) }));
      }
    })();
    return () => { cancelled = true; };
  }, [solve, analysis]);
  return load;
}

/**
 * How a solve went and what would have been better, step by step.
 *
 * Follows the replay: the step the cursor is in is the one described. Every alternative
 * can be played on the cube from where it starts.
 */
export function SolveReviewPanel({
  solve,
  analysis,
  activeStep,
  onPreview,
}: {
  solve: Solve;
  analysis: SolveAnalysis;
  activeStep: number;
  onPreview: (preview: ReviewPreview) => void;
}) {
  const { result, done, total, failed } = useAlternatives(solve, analysis);
  const step = analysis.steps[activeStep] as SolveStep | undefined;
  const better = result?.steps[activeStep];
  const play = (label: string, alternative: Alternative, fromMove = alternative.fromMove) =>
    onPreview({ label, fromMove, cubeMoves: alternative.cubeMoves, alg: alternative.alg });

  return (
    <div className="review-panel">
      {result ? <GripLabel bottom={result.grip.bottom} front={result.grip.front}
        prefix="Sequences are written as you held the cube:" /> : null}
      {failed ? <div className="notice error">{failed}</div> : null}
      {!result && !failed ? <div className="small faint">Looking for better solutions… {done} of {total}</div> : null}

      {result ? <SolveSummary result={result} onPlay={play} /> : null}

      {step ? (
        <section className="review-section" aria-label={`${step.name} review`}>
          <div className="panel-title">{step.name}</div>
          <WhatYouDid step={step} analysis={analysis} />
          {better ? <Better step={step} better={better} result={result!} onPlay={play} />
            : !failed ? <div className="small faint">Still searching this step…</div> : null}
        </section>
      ) : null}
    </div>
  );
}

function Saving({ used, best }: { used: number; best: number }) {
  const saved = used - best;
  return (
    <span className="mono review-count">
      {used} → <b className={saved > 0 ? "saving" : ""}>{best}</b>
      {saved > 0 ? <span className="chip">{saved} fewer</span> : null}
    </span>
  );
}

function PlayButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="ghost small review-play" onClick={onClick} aria-label={`Show ${label}`}>▶ Show</button>;
}

function AlternativeLine({ label, alternative, used, note, onPlay }: {
  label: string; alternative: Alternative; used?: number; note?: string;
  onPlay: (label: string, alternative: Alternative) => void;
}) {
  return (
    <div className="review-alt">
      <div className="row">
        <b>{label}</b>
        <span className="grow" />
        {used === undefined ? <span className="mono dim">{alternative.length} mv</span> : <Saving used={used} best={alternative.length} />}
        <PlayButton label={label} onClick={() => onPlay(label, alternative)} />
      </div>
      {note ? <div className="small faint">{note}</div> : null}
      <div className="mono small dim review-alg">{alternative.alg}</div>
    </div>
  );
}

function SolveSummary({ result, onPlay }: {
  result: SolveAlternatives;
  onPlay: (label: string, alternative: Alternative) => void;
}) {
  const { cross, pairOrder, wholeSolve } = result;
  return (
    <section className="review-section" aria-label="Whole solve">
      <div className="panel-title">Whole solve</div>
      {cross ? <AlternativeLine label="Best cross" alternative={cross.best} used={cross.used}
        note="Shortest cross from the scramble, whatever it does to the rest." onPlay={onPlay} /> : null}
      {cross?.xcross && cross.xcross.pairs.length === 1 ? <AlternativeLine label="XCross" alternative={cross.xcross}
        note={`Cross and the ${cross.xcross.pairs.join(" ")} pair together.`} onPlay={onPlay} /> : null}
      {cross?.xxcross ? <AlternativeLine label="XXCross" alternative={cross.xxcross}
        note={`Cross and the ${cross.xxcross.pairs.join(" and ")} pairs together.`} onPlay={onPlay} /> : null}
      {pairOrder ? <AlternativeLine label="Best pair order" alternative={pairOrder} used={pairOrder.used}
        note={`From your cross, ${pairOrder.parts.map((part) => `${part.slot} (${part.length})`).join(", then ")}, with catalogue algorithms.`}
        onPlay={onPlay} /> : null}
      {wholeSolve ? <AlternativeLine label="Computer solution" alternative={wholeSolve} used={wholeSolve.used}
        note="A solver's answer to the same scramble, as a yardstick." onPlay={onPlay} /> : null}
    </section>
  );
}

/** Where the pair went in, in the solver's hands. */
function heldSlot(analysis: SolveAnalysis, step: SolveStep): F2lPosition | null {
  const held = step.insertedAt ?? slotInHeldFrame(rotationForCrossFace(analysis.crossFace).orientation, step.slot);
  return (F2L_POSITIONS as readonly string[]).includes(held ?? "") ? held as F2lPosition : null;
}

function WhatYouDid({ step, analysis }: { step: SolveStep; analysis: SolveAnalysis }) {
  const facts: string[] = [];
  if (step.solvedDuring) facts.push(`Went in with the ${step.solvedDuring === "Cross" ? "cross" : step.solvedDuring}, so it took no moves of its own.`);
  else if (step.skipped) facts.push("Skipped: nothing to do.");
  if (step.slot) {
    const position = heldSlot(analysis, step);
    facts.push(`${position ? `${f2lPositionLabel(position)} slot` : "Pair"}${step.case ? `, case ${step.case}` : ""}.`);
  } else if (step.case && step.case !== "Solved") {
    facts.push(`Case ${step.name === "OLL" ? `OLL ${step.case}` : `${step.case} perm`}.`);
  }
  if (step.executedAlg) {
    facts.push(step.setupMoves
      ? `${step.setupMoves} ${step.setupMoves === 1 ? "move" : "moves"} first, then the catalogue algorithm ${step.executedAlg.alg}.`
      : `The catalogue algorithm ${step.executedAlg.alg}.`);
  } else if (step.sliceTurns > 0 && step.slot) {
    facts.push("No catalogue algorithm: solved intuitively.");
  }
  return (
    <div className="review-did">
      <div className="small dim">What you did</div>
      <div className="row small">
        <span className="mono">{step.sliceTurns} mv</span>
        {step.timeMs > 0 ? <span className="faint">{formatTime(step.recognitionMs)} looking · {formatTime(step.executionMs)} turning</span> : null}
      </div>
      {facts.map((fact) => <div key={fact} className="small">{fact}</div>)}
      {step.looks && step.looks.length > 1 ? (
        <ol className="review-looks small">
          {step.looks.map((look) => (
            <li key={look.fromMove}>
              {look.label ?? look.case ?? "Unknown"} <span className="faint">({look.kind}) · {formatTime(look.recognitionMs)} looking</span>
            </li>
          ))}
        </ol>
      ) : null}
      {step.moves ? <div className="mono small dim review-alg">{step.moves}</div> : null}
    </div>
  );
}

function Better({ step, better, result, onPlay }: {
  step: SolveStep;
  better: StepAlternatives;
  result: SolveAlternatives;
  onPlay: (label: string, alternative: Alternative, fromMove?: number) => void;
}) {
  const { sameResult } = better;
  return (
    <div className="review-better">
      <div className="small dim">What would have been better</div>
      {step.name === "Cross" && result.cross ? (
        <div className="small faint">See the best cross and XCross above.</div>
      ) : null}
      {sameResult.best && better.sameResultMoves ? (
        <AlternativeLine label="Same result, shorter" used={sameResult.used}
          alternative={{ alg: sameResult.best, length: sameResult.bestLength, fromMove: step.fromMove, cubeMoves: better.sameResultMoves }}
          note="The fewest moves to the very same position. Searched exhaustively." onPlay={onPlay} />
      ) : step.sliceTurns > 0 ? (
        <div className="small faint">
          {sameResult.optimal ? "Already the shortest way to this position."
            : sameResult.tooDeep ? `Over ${MAX_SEARCH_DEPTH + 1} moves: too long to search for a shorter way.` : null}
        </div>
      ) : null}
      {better.pairChoices && better.pairChoices.length > 0 ? (
        <table className="review-choices small">
          <caption className="small dim">Pairs you could have done next</caption>
          <thead><tr><th scope="col">Slot</th><th scope="col">Case</th><th scope="col">Moves</th><th scope="col"><span className="sr-only">Show</span></th></tr></thead>
          <tbody>
            {[...better.pairChoices]
              .sort((a, b) => (a.best?.length ?? 99) - (b.best?.length ?? 99))
              .map((choice) => (
                <tr key={choice.slot} className={choice.chosen ? "chosen" : undefined}>
                  <th scope="row">{f2lPositionLabel(choice.position)}{choice.chosen ? <span className="chip">yours</span> : null}</th>
                  <td>{choice.case ?? <span className="faint">{choice.best ? "stuck — freed first" : "stuck"}</span>}</td>
                  <td className="mono">{choice.best ? choice.best.length : "—"}</td>
                  <td>{choice.best ? <PlayButton label={`${f2lPositionLabel(choice.position)} pair`}
                    onClick={() => onPlay(`${f2lPositionLabel(choice.position)} pair (${choice.case})`, choice.best!)} /> : null}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : null}
      {better.reference ? (
        <AlternativeLine label={`One-look ${better.reference.label}`} alternative={better.reference}
          used={step.looks && step.looks.length > 1 ? step.sliceTurns : undefined}
          note={step.looks && step.looks.length > 1 ? `You did it in ${step.looks.length} looks.` : "The shortest catalogue algorithm for this case."}
          onPlay={onPlay} />
      ) : null}
    </div>
  );
}
