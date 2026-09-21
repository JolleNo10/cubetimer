import { useEffect, useState } from "react";
import { Alg } from "cubing/alg";
import { get3x3x3 } from "../cube/puzzle";
import { analyseAlternatives, type SolveAnalytics, type StepAnalytics } from "../state/analytics";
import { MAX_SEARCH_DEPTH } from "../cube/optimise";
import { formatTime } from "../state/stats";
import { effectiveMs, type Solve } from "../state/types";

/**
 * What a solve could have been: the best cross available, the shortest way to have
 * done each step, and the standard algorithm for the last-layer cases.
 */
export function AnalyticsDialog({
  solve,
  onClose,
}: {
  solve: Solve;
  onClose: () => void;
}) {
  const [result, setResult] = useState<SolveAnalytics | null>(null);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const kpuzzle = await get3x3x3();
        const scrambled = kpuzzle.defaultPattern().applyAlg(new Alg(solve.scramble));
        const analytics = await analyseAlternatives(kpuzzle, solve, scrambled, () => {
          if (!cancelled) setDone((n) => n + 1);
        });
        if (!cancelled) setResult(analytics);
      } catch (error) {
        if (!cancelled) setFailed(String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [solve]);

  const total = solve.analysis?.steps.length ?? 7;

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Analysis tools"
      >
        <div className="dialog-head">
          <div className="row">
            <h3>Analysis tools</h3>
            <span className="mono dim">{formatTime(effectiveMs(solve))}</span>
            <span className="faint small">
              {solve.analysis?.sliceTurns ?? solve.moves.length} moves
            </span>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="dialog-body">
          <div className="mono small faint" style={{ wordBreak: "break-word" }}>
            {solve.scramble}
          </div>

          {failed ? (
            <div className="notice error">{failed}</div>
          ) : !result ? (
            <div className="empty">
              Looking for better solutions… {done} of {total} steps
            </div>
          ) : (
            <Results result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

function Results({ result }: { result: SolveAnalytics }) {
  return (
    <>
      {result.wholeSolve ? (
        <Headline
          title="The whole solve"
          used={result.wholeSolve.used}
          best={result.wholeSolve.length}
          note="a solver's solution to the same scramble"
          alg={result.wholeSolve.alg}
        />
      ) : null}

      {result.cross ? (
        <Headline
          title="The best cross"
          used={result.cross.used}
          best={result.cross.length}
          note="shortest cross from the scramble, whatever it does to the rest"
          alg={result.cross.alg}
        />
      ) : null}

      <div className="panel-title" style={{ marginTop: 6 }}>
        Step by step
      </div>
      <div className="small faint" style={{ marginTop: -6 }}>
        The shortest way to have reached the same position. Searched exhaustively, so
        "already the shortest" means there is nothing better, not that none was found.
      </div>

      {result.steps.map((step) => (
        <StepResult key={step.name} step={step} />
      ))}
    </>
  );
}

function Headline({
  title,
  used,
  best,
  note,
  alg,
}: {
  title: string;
  used: number;
  best: number;
  note: string;
  alg: string;
}) {
  const saved = used - best;
  return (
    <div className="headline">
      <div className="row">
        <b>{title}</b>
        <span className="grow" />
        <span className="mono">
          {used} → <b className={saved > 0 ? "saving" : ""}>{best}</b>
        </span>
        {saved > 0 ? <span className="chip">{saved} fewer</span> : null}
      </div>
      <div className="small faint">{note}</div>
      {alg ? (
        <div className="mono small dim" style={{ wordBreak: "break-word", marginTop: 4 }}>
          {alg}
        </div>
      ) : null}
    </div>
  );
}

function StepResult({ step }: { step: StepAnalytics }) {
  return (
    <div className="analytics-row">
      <span className="phase-name">{step.name}</span>
      <span className="mono small dim">{step.used} mv</span>
      <span className="analytics-verdict">
        {step.moves ? (
          <div className="mono small dim" style={{ marginBottom: 3 }}>
            {step.moves}
          </div>
        ) : null}
        {step.used === 0 ? (
          <span className="faint">skipped</span>
        ) : step.best ? (
          <>
            <span className="chip">{step.used - step.bestLength} fewer</span>{" "}
            <span className="mono">{step.best}</span>
          </>
        ) : step.optimal ? (
          <span className="faint">already the shortest</span>
        ) : (
          <span className="faint">
            over {MAX_SEARCH_DEPTH + 1} moves — too long to search
          </span>
        )}
        {step.reference ? (
          <div className="small faint" style={{ marginTop: 3 }}>
            standard {step.reference.label} is {step.reference.length} moves:{" "}
            <span className="mono">{step.reference.alg}</span>
          </div>
        ) : null}
      </span>
    </div>
  );
}
