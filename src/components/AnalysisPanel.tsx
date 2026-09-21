import { useMemo } from "react";
import type { SolveAnalysis, SolveStep } from "../cube/analysis";
import { faceColour, slotColours } from "../cube/colours";
import { ollGroupForCase } from "../cube/lastLayerCases";
import { formatTime } from "../state/stats";
import type { Solve } from "../state/types";

const STEP_COLORS: Record<string, string> = {
  Cross: "var(--blue)",
  "F2L Slot 1": "var(--accent)",
  "F2L Slot 2": "var(--accent)",
  "F2L Slot 3": "var(--accent)",
  "F2L Slot 4": "var(--accent)",
  OLL: "var(--amber)",
  PLL: "var(--violet)",
};

/**
 * CFOP breakdown of a solve: how long each step took, how much of that was spent
 * looking rather than turning, which case came up, and where the long pauses were.
 */
export function AnalysisPanel({
  solve,
  onReplay,
}: {
  solve: Solve | null;
  onReplay: (solve: Solve) => void;
}) {
  const analysis = solve?.analysis ?? null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Solve breakdown</span>
        {solve && solve.moves.length > 0 ? (
          <button className="ghost" onClick={() => onReplay(solve)}>
            Replay
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {!solve ? (
          <div className="empty">Finish a solve to see its breakdown.</div>
        ) : !analysis ? (
          <div className="empty">
            {solve.source === "keyboard"
              ? "Connect a smart cube to get a move-by-move breakdown."
              : "This solve has no step analysis."}
          </div>
        ) : (
          <Breakdown analysis={analysis} />
        )}
      </div>
    </div>
  );
}

function Breakdown({ analysis }: { analysis: SolveAnalysis }) {
  const total = Math.max(1, analysis.solvingMs);
  return (
    <>
      <div className="row small faint" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        <span>
          cross on{" "}
          <b className="dim" title={`${analysis.crossFace} face`}>
            <span
              className="colour-dot"
              style={{ background: faceColour(analysis.crossFace).hex }}
            />
            {faceColour(analysis.crossFace).name}
          </b>
        </span>
        <span className="grow" />
        <span title="Slice turn metric · quarter turn metric">
          {analysis.sliceTurns} STM · {analysis.quarterTurns} QTM
        </span>
        <span>{analysis.tps.toFixed(2)} tps</span>
      </div>

      {analysis.steps.map((step) => (
        <StepRow key={step.name} step={step} total={total} />
      ))}

      <div className="legend">
        <span>
          <i style={{ background: "color-mix(in oklab, var(--blue) 55%, transparent)" }} />
          recognition
        </span>
        <span>
          <i style={{ background: "var(--accent)" }} />
          execution
        </span>
        <span className="grow" />
        <span>
          {formatTime(analysis.totalRecognitionMs)} looking ·{" "}
          {formatTime(analysis.totalExecutionMs)} turning
        </span>
      </div>

      <MoveGraph analysis={analysis} />

      {analysis.pauses.length > 0 ? (
        <div className="small faint" style={{ marginTop: 10 }}>
          {analysis.pauses.length} pause{analysis.pauses.length === 1 ? "" : "s"} over
          250&nbsp;ms, {formatTime(
            analysis.pauses.reduce((sum, p) => sum + p.durationMs, 0),
          )}
          s in total
          {analysis.turnsAfterSolution > 0
            ? ` · ${analysis.turnsAfterSolution} turns after the cube was solved`
            : ""}
        </div>
      ) : null}
    </>
  );
}

/**
 * Split a case into the bit that identifies it and the bit that describes it.
 *
 * An OLL is a number, and its shape group is the hint. An F2L case is written
 * `FL->FR 22`: the number identifies it, the slots say where the pair came from.
 */
function describeCase(step: SolveStep): { id: string; hint?: string } | null {
  // A pair is named by the colours that meet in the slot it filled.
  const pair = step.slot ? slotColours(step.slot) : null;
  if (!step.case) return pair ? { id: pair } : null;
  const slots = /^(.*?)->(\S+)\s+(\S+)$/.exec(step.case);
  if (slots) {
    const from = slots[1].replace(/[[\]]/g, "").replace(",", "/");
    return { id: pair ?? slots[3], hint: pair ? slots[3] : `${from}→${slots[2]}` };
  }
  if (step.name === "OLL") {
    const group = ollGroupForCase(step.case);
    // "C" on its own is cryptic; "C shape" is what a cuber would say.
    const hint =
      group && group.length === 1 ? `${group} shape` : (group ?? undefined);
    return { id: step.case, hint };
  }
  if (pair) return { id: pair, hint: step.case };
  return { id: step.case };
}

function StepRow({ step, total }: { step: SolveStep; total: number }) {
  const width = (step.timeMs / total) * 100;
  const recognitionShare =
    step.timeMs > 0 ? (step.recognitionMs / step.timeMs) * 100 : 0;
  const described = describeCase(step);
  const isSkip = step.skipped || described?.id === "Solved";

  return (
    <div className="phase-row" title={step.moves || undefined}>
      <span className="phase-head">
        <span className="phase-name">{step.name}</span>
        {described ? (
          <span className={`phase-case${isSkip ? " muted" : ""}`}>
            {described.id === "Solved" ? "skip" : described.id}
          </span>
        ) : step.skipped ? (
          <span className="phase-case muted">skip</span>
        ) : null}
        {described?.hint ? <span className="phase-hint">{described.hint}</span> : null}
      </span>
      <span className="phase-time">{formatTime(step.timeMs)}</span>
      <span className="phase-bar">
        <span
          className="recognition"
          style={{ width: `${(width * recognitionShare) / 100}%` }}
        />
        <span
          className="execution"
          style={{
            width: `${(width * (100 - recognitionShare)) / 100}%`,
            background: STEP_COLORS[step.name] ?? "var(--accent)",
          }}
        />
      </span>
      <span className="phase-sub">
        {step.sliceTurns} mv · {step.tps.toFixed(1)} tps
      </span>
    </div>
  );
}

/** Per-move time, coloured by step — the shape of a solve at a glance. */
function MoveGraph({ analysis }: { analysis: SolveAnalysis }) {
  const bars = useMemo(() => {
    const result: { gap: number; color: string; move: string }[] = [];
    let previous = 0;
    for (const step of analysis.steps) {
      const color = STEP_COLORS[step.name] ?? "var(--accent)";
      for (const { move, t } of step.recordedMoves) {
        result.push({ gap: Math.max(0, t - previous), color, move });
        previous = t;
      }
    }
    return result;
  }, [analysis]);

  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.gap), 1);

  return (
    <svg
      viewBox={`0 0 ${bars.length} 100`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 54, marginTop: 12, display: "block" }}
      role="img"
      aria-label="Time taken by each move"
    >
      {bars.map((bar, i) => {
        const height = Math.max(2, (bar.gap / max) * 100);
        return (
          <rect
            key={i}
            x={i + 0.15}
            y={100 - height}
            width={0.7}
            height={height}
            fill={bar.color}
            opacity={0.85}
          >
            <title>{`${bar.move} — ${Math.round(bar.gap)} ms`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
