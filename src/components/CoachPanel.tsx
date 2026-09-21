import { useEffect, useRef, useState } from "react";
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { faceColour, faceOfColour, slotColours } from "../cube/colours";
import { planCross, type CrossPlans } from "../cube/crossPlans";
import { planF2l, type F2lSlotPlan } from "../cube/f2l";
import { faceletsToPattern } from "../cube/facelets";
import { EDGES_OF_FACE } from "../cube/moves";
import { invertMoves } from "../cube/notation";
import {
  gripFaces,
  reorientMove,
  rotationForCrossFace,
  rotationForGrip,
  slotInCubeFrame,
  type Orientation,
} from "../cube/orientation";
import { get3x3x3 } from "../cube/puzzle";
import { reframe } from "../cube/recognise";
import type { TimerPhase } from "../state/controller";
import type { Settings } from "../state/types";
import { GripLabel } from "./GripLabel";

/** Wait this long after the last turn before thinking, so turning stays smooth. */
const SETTLE_MS = 180;

type Progress =
  | { stage: "cross"; plans: CrossPlans }
  | { stage: "f2l"; slots: F2lSlotPlan[]; crossDone: boolean };

/**
 * What to do next, while you are looking at the cube.
 *
 * Only shown during a slow solve, where stopping to think is the point. It follows the
 * solve in two stages. Until the cross is done it reads the cube as it stands and
 * works out every way of finishing the cross within a couple of moves of the shortest,
 * putting the ones that also finish a pair at the top. The moment the cross is
 * finished it stops planning crosses for good — the question has been answered, and
 * re-answering it every time a pair goes in would only be a distraction — and names
 * the F2L case standing in each remaining slot instead.
 *
 * Nothing is searched while the scramble is still being applied: the cube is not yet
 * at the position the answer is about.
 */
export function CoachPanel({
  facelets,
  settings,
  phase,
  scramble,
  liveMoves,
}: {
  facelets: string;
  settings: Settings;
  phase: TimerPhase;
  scramble: string;
  liveMoves: readonly string[];
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [wide, setWide] = useState(false);
  const [thinking, setThinking] = useState(false);
  // Once the cross has been done in this attempt it stays done, however the cube is
  // turned afterwards. Kept in a ref because the reading that sets it is the same one
  // that reads it, and a re-render in between would plan a cross nobody asked for.
  const crossEverDone = useRef(false);

  const scrambling = phase === "scrambling";

  useEffect(() => {
    // A fresh attempt starts over; once it is under way, nothing resets it.
    if (phase === "solving" || phase === "finished") return;
    crossEverDone.current = false;
  }, [scramble, phase]);

  useEffect(() => {
    if (scrambling) {
      setProgress(null);
      setThinking(false);
      return;
    }
    let cancelled = false;
    setThinking(true);
    const timer = setTimeout(() => {
      void (async () => {
        const kpuzzle = await get3x3x3();
        if (cancelled) return;
        const next = read(
          kpuzzle,
          facelets,
          settings,
          wide ? 3 : 2,
          crossEverDone.current,
        );
        if (cancelled) return;
        if (next?.stage === "f2l") crossEverDone.current = true;
        setProgress(next);
        setThinking(false);
      })();
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [facelets, settings, wide, scrambling]);

  const crossColour = faceOfColour(settings.crossColour) ?? "D";
  const frontColour = faceOfColour(settings.frontColour);
  // The plans are moves, and moves mean nothing without knowing which way the cube is
  // being held, so the grip they assume is part of the heading.
  const orientation = (
    (frontColour && rotationForGrip(crossColour, frontColour)) ??
    rotationForCrossFace(crossColour)
  ).orientation;
  const grip = gripFaces(orientation);
  const planning = progress?.stage === "f2l" ? "F2L" : "cross";

  return (
    <div className="panel coach">
      <div className="panel-head">
        <span className="panel-title">
          <span
            className="colour-dot"
            style={{ background: faceColour(crossColour).hex }}
          />
          {faceColour(crossColour).name} {planning}
        </span>
        <div className="row">
          <GripLabel bottom={grip.bottom} front={grip.front} />
          {thinking ? <span className="faint small">thinking…</span> : null}
          {progress?.stage === "cross" ? (
            <button
              className="ghost small"
              onClick={() => setWide((w) => !w)}
              title="Consider crosses up to three moves longer than the shortest"
            >
              {wide ? "closer" : "wider"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="panel-body">
        {scrambling ? (
          <div className="empty">Finish the scramble and the plans appear.</div>
        ) : !progress ? (
          <div className="empty">Reading the cube…</div>
        ) : progress.stage === "cross" ? (
          <Plans plans={progress.plans} orientation={orientation} />
        ) : (
          <Slots progress={progress} orientation={orientation} />
        )}
        <Rewind moves={liveMoves} orientation={orientation} />
      </div>
    </div>
  );
}

function Plans({
  plans,
  orientation,
}: {
  plans: CrossPlans;
  orientation: Orientation;
}) {
  if (plans.plans.length === 0) {
    return <div className="empty">No cross found from here.</div>;
  }
  return (
    <>
      <div className="small faint" style={{ marginBottom: 8 }}>
        Shortest cross is {plans.shortest} moves
        {plans.exhausted ? "" : " — search cut short, there may be better"}.
      </div>
      {plans.plans.map((plan, i) => (
        <div className="plan-row" key={i}>
          <span className="plan-kind">
            {plan.pairs.length >= 2
              ? "XXCross"
              : plan.pairs.length === 1
                ? "XCross"
                : "Cross"}
            <small>{plan.moves.length} moves</small>
          </span>
          <span className="mono plan-moves">{plan.moves.join(" ")}</span>
          {plan.pairs.length > 0 ? (
            <span className="plan-pairs">
              {plan.pairs.map((pair) => (
                <span className="phase-case" key={pair}>
                  {pairName(pair, orientation)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

/**
 * What to call a slot out loud.
 *
 * The planners work on a cube turned cross-face down, so their slot names are
 * positions in the hand rather than faces. Turning one back into the cube's own frame
 * is what makes it "green-orange" instead of whatever `FR` happens to read as.
 */
function pairName(slot: string, orientation: Orientation): string {
  const faces = slotInCubeFrame(orientation, slot);
  return slotColours(faces) ?? faces;
}

/** The four slots, each with the case standing in it and the algorithm for it. */
function Slots({
  progress,
  orientation,
}: {
  progress: Progress & { stage: "f2l" };
  orientation: Orientation;
}) {
  const left = progress.slots.filter((slot) => slot.status !== "solved");
  return (
    <>
      <div className="small faint" style={{ marginBottom: 8 }}>
        {!progress.crossDone
          ? "The cross is broken — these algorithms assume it is not."
          : left.length === 0
            ? "First two layers finished."
            : `Cross done, ${left.length} pair${left.length === 1 ? "" : "s"} to go.`}
      </div>
      {progress.slots.map((slot) => (
        <div className="plan-row slot-row" key={slot.name}>
          <span className="plan-kind">
            {pairName(slot.name, orientation)}
            <small>
              {slot.status === "solved"
                ? "done"
                : (slot.solution?.name ?? "buried")}
            </small>
          </span>
          {slot.status === "case" ? (
            <span className="mono plan-moves">{slot.solution?.moves.join(" ")}</span>
          ) : (
            <span className="plan-moves faint">
              {slot.status === "solved"
                ? "nothing to do"
                : "a piece of this pair is in another slot — free it first"}
            </span>
          )}
          {slot.solution ? (
            <span className="plan-pairs">
              <span className="phase-case">{slot.solution.group}</span>
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

/**
 * The way back to the scramble: everything turned so far, backwards.
 *
 * Trying a plan and then rewinding to look at the same position again is how you study
 * one, and counting the moves back off your own fingers is exactly the distraction
 * that loses the position. Written in the grip the cube is held in, like everything
 * else here, rather than in the frame the cube reports its turns in.
 */
function Rewind({
  moves,
  orientation,
}: {
  moves: readonly string[];
  orientation: Orientation;
}) {
  const back = invertMoves(moves.map((move) => reorientMove(move, orientation)));
  if (back.length === 0) return null;
  return (
    <div className="rewind">
      <span className="small faint">
        Back to the scramble <small>{back.length} moves</small>
      </span>
      <span className="mono small">{back.join(" ")}</span>
    </div>
  );
}

/** Read the cube as it stands, from the solver's side of it. */
function read(
  kpuzzle: KPuzzle,
  facelets: string,
  settings: Settings,
  extra: number,
  crossAlreadyDone: boolean,
): Progress | null {
  const bottom = faceOfColour(settings.crossColour);
  if (!bottom) return null;
  let pattern;
  try {
    pattern = faceletsToPattern(kpuzzle, facelets);
  } catch {
    return null;
  }
  const front = faceOfColour(settings.frontColour);
  const grip =
    (front && rotationForGrip(bottom, front)) ?? rotationForCrossFace(bottom);
  const facing = reframe(kpuzzle, pattern, new Alg(grip.tokens.join(" ")));

  const edges = facing.patternData.EDGES;
  const crossDone = EDGES_OF_FACE.D.every(
    (slot) => edges.pieces[slot] === slot && edges.orientation[slot] === 0,
  );
  if (crossAlreadyDone || crossDone) {
    return { stage: "f2l", slots: planF2l(kpuzzle, facing), crossDone };
  }
  return { stage: "cross", plans: planCross(kpuzzle, facing, { extra }) };
}
