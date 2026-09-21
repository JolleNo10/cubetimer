import { useEffect, useState } from "react";
import { Alg } from "cubing/alg";
import type { KPuzzle } from "cubing/kpuzzle";
import { faceColour, faceOfColour, slotColours } from "../cube/colours";
import { planCross, type CrossPlans } from "../cube/crossPlans";
import { faceletsToPattern } from "../cube/facelets";
import { EDGES_OF_FACE, f2lSlotsForCrossFace } from "../cube/moves";
import { rotationForCrossFace, rotationForGrip } from "../cube/orientation";
import { get3x3x3 } from "../cube/puzzle";
import { reframe } from "../cube/recognise";
import type { Settings } from "../state/types";

/** Wait this long after the last turn before thinking, so turning stays smooth. */
const SETTLE_MS = 180;

type Progress = {
  crossDone: boolean;
  pairsDone: string[];
  pairsLeft: string[];
  plans: CrossPlans | null;
};

/**
 * What to do next, while you are looking at the cube.
 *
 * Only shown during a slow solve, where stopping to think is the point. It reads the
 * cube as it stands, works out every way of finishing the cross within a couple of
 * moves of the shortest, and puts the ones that also finish a pair at the top.
 */
export function CoachPanel({
  facelets,
  settings,
}: {
  facelets: string;
  settings: Settings;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [wide, setWide] = useState(false);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setThinking(true);
    const timer = setTimeout(() => {
      void (async () => {
        const kpuzzle = await get3x3x3();
        if (cancelled) return;
        const next = read(kpuzzle, facelets, settings, wide ? 3 : 2);
        if (!cancelled) {
          setProgress(next);
          setThinking(false);
        }
      })();
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [facelets, settings, wide]);

  const crossColour = faceOfColour(settings.crossColour) ?? "D";

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <span
            className="colour-dot"
            style={{ background: faceColour(crossColour).hex }}
          />
          {faceColour(crossColour).name} cross
        </span>
        <div className="row">
          {thinking ? <span className="faint small">thinking…</span> : null}
          {progress && !progress.crossDone ? (
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
        {!progress ? (
          <div className="empty">Reading the cube…</div>
        ) : progress.crossDone ? (
          <Done progress={progress} />
        ) : (
          <Plans progress={progress} />
        )}
      </div>
    </div>
  );
}

function Plans({ progress }: { progress: Progress }) {
  const plans = progress.plans;
  if (!plans || plans.plans.length === 0) {
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
                  {slotColours(pair) ?? pair}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

function Done({ progress }: { progress: Progress }) {
  return (
    <>
      <div className="row small" style={{ marginBottom: 8 }}>
        <b className="dim">Cross done.</b>
        <span className="faint">
          {progress.pairsLeft.length === 0
            ? "First two layers finished."
            : `${progress.pairsLeft.length} pair${
                progress.pairsLeft.length === 1 ? "" : "s"
              } to go.`}
        </span>
      </div>
      <div className="row wrap">
        {progress.pairsDone.map((pair) => (
          <span className="phase-case" key={pair}>
            {slotColours(pair) ?? pair}
          </span>
        ))}
        {progress.pairsLeft.map((pair) => (
          <span className="phase-case muted" key={pair}>
            {slotColours(pair) ?? pair}
          </span>
        ))}
      </div>
    </>
  );
}

/** Read the cube as it stands, from the solver's side of it. */
function read(
  kpuzzle: KPuzzle,
  facelets: string,
  settings: Settings,
  extra: number,
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
  const corners = facing.patternData.CORNERS;
  const crossDone = EDGES_OF_FACE.D.every(
    (slot) => edges.pieces[slot] === slot && edges.orientation[slot] === 0,
  );
  const pairs = f2lSlotsForCrossFace("D");
  const solved = (pair: (typeof pairs)[number]) =>
    corners.pieces[pair.corner] === pair.corner &&
    corners.orientation[pair.corner] === 0 &&
    edges.pieces[pair.edge] === pair.edge &&
    edges.orientation[pair.edge] === 0;

  return {
    crossDone,
    pairsDone: pairs.filter(solved).map((p) => p.name),
    pairsLeft: pairs.filter((p) => !solved(p)).map((p) => p.name),
    plans: crossDone ? null : planCross(kpuzzle, facing, { extra }),
  };
}
