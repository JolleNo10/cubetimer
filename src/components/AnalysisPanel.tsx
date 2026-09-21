import { useMemo } from "react";
import type { Phase, SolveAnalysis, TimedMove } from "../cube/analysis";
import { formatTime } from "../state/stats";
import type { Solve } from "../state/types";

const PHASE_COLORS: Record<string, string> = {
  Cross: "var(--blue)",
  "F2L #1": "var(--accent)",
  "F2L #2": "var(--accent)",
  "F2L #3": "var(--accent)",
  "F2L #4": "var(--accent)",
  OLL: "var(--amber)",
  PLL: "var(--violet)",
};

/**
 * CFOP breakdown of a solve: how long each phase took, how much of that was spent
 * looking rather than turning, and where the long pauses were.
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
              : "This solve could not be broken into phases."}
          </div>
        ) : (
          <Breakdown analysis={analysis} moves={solve.moves} />
        )}
      </div>
    </div>
  );
}

function Breakdown({
  analysis,
  moves,
}: {
  analysis: SolveAnalysis;
  moves: TimedMove[];
}) {
  const total = Math.max(1, analysis.durationMs);
  return (
    <>
      <div className="row small faint" style={{ marginBottom: 6 }}>
        <span>
          cross on <b className="dim">{analysis.crossFace}</b>
        </span>
        <span className="grow" />
        <span>
          {analysis.moveCount} moves · {analysis.tps.toFixed(2)} tps
        </span>
      </div>

      {analysis.phases.map((phase) => (
        <PhaseRow key={phase.name} phase={phase} total={total} />
      ))}

      <div className="legend">
        <span>
          <i style={{ background: "color-mix(in oklab, var(--blue) 55%, transparent)" }} />
          look ahead / recognition
        </span>
        <span>
          <i style={{ background: "var(--accent)" }} />
          turning
        </span>
      </div>

      <MoveGraph analysis={analysis} moves={moves} />

      {analysis.pauses.length > 0 ? (
        <div className="small faint" style={{ marginTop: 10 }}>
          {analysis.pauses.length} pause{analysis.pauses.length === 1 ? "" : "s"} over
          250&nbsp;ms, {formatTime(
            analysis.pauses.reduce((sum, p) => sum + p.durationMs, 0),
          )}
          s in total
        </div>
      ) : null}
    </>
  );
}

function PhaseRow({ phase, total }: { phase: Phase; total: number }) {
  const width = (phase.durationMs / total) * 100;
  const recognitionShare =
    phase.durationMs > 0 ? (phase.recognitionMs / phase.durationMs) * 100 : 0;
  return (
    <div className="phase-row">
      <span className="phase-name">
        {phase.name}
        {phase.detail ? <small>{phase.detail} slot</small> : null}
        {phase.moveCount === 0 && phase.name !== "Cross" ? <small>skip</small> : null}
      </span>
      <span className="phase-bar" title={`${phase.moveCount} moves`}>
        <span
          className="recognition"
          style={{ width: `${(width * recognitionShare) / 100}%` }}
        />
        <span
          className="execution"
          style={{
            width: `${(width * (100 - recognitionShare)) / 100}%`,
            background: PHASE_COLORS[phase.name] ?? "var(--accent)",
          }}
        />
      </span>
      <span className="phase-time">
        {formatTime(phase.durationMs)}
        <small>
          {phase.moveCount} mv · {phase.tps.toFixed(1)} tps
        </small>
      </span>
    </div>
  );
}

/** Per-move time, coloured by phase — the shape of a solve at a glance. */
function MoveGraph({
  analysis,
  moves,
}: {
  analysis: SolveAnalysis;
  moves: TimedMove[];
}) {
  const bars = useMemo(() => {
    const colorOf = (index: number) => {
      const phase = analysis.phases.find(
        (p) => index >= p.fromMove && index < p.toMove,
      );
      return PHASE_COLORS[phase?.name ?? ""] ?? "var(--accent)";
    };
    let previous = 0;
    return moves.map((move, i) => {
      const gap = move.t - previous;
      previous = move.t;
      return { gap, color: colorOf(i), move: move.move, t: move.t };
    });
  }, [analysis, moves]);

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
          <rect key={i} x={i + 0.15} y={100 - height} width={0.7} height={height} fill={bar.color} opacity={0.85}>
            <title>{`${bar.move} — ${Math.round(bar.gap)} ms`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
