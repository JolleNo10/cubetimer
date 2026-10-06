import type { SolveAnalysis } from "../../../../cube/analysis";
import { isRotation, parseMove } from "../../../../cube/notation";
import { paleColour, seconds, shortStep, stepColour } from "./chartParts";

const SIZE = 340;
const CENTRE = SIZE / 2;
const OUTER = 128;
const INNER = 106;

/**
 * The solve as one lap of a stopwatch: turning on the outer ring, recognising on the
 * inner one, a tick on the rim for every move.
 */
export function SolveDial({ analysis }: { analysis: SolveAnalysis }) {
  const first = analysis.steps[0];
  const origin = first ? first.cumulativeMs - first.timeMs : 0;
  const total = Math.max(1, (analysis.steps.at(-1)?.cumulativeMs ?? 0) - origin);
  const angle = (ms: number) => -Math.PI / 2 + ((ms - origin) / total) * Math.PI * 2;
  const point = (ms: number, radius: number) => [CENTRE + radius * Math.cos(angle(ms)), CENTRE + radius * Math.sin(angle(ms))] as const;
  const arc = (from: number, to: number, radius: number) => {
    const [x0, y0] = point(from, radius), [x1, y1] = point(to, radius);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${radius},${radius} 0 ${to - from > total / 2 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const gap = total * 0.004;
  const turns = analysis.steps.flatMap((step) => step.recordedMoves.filter((move) => {
    const parsed = parseMove(move.move);
    return parsed !== null && !isRotation(parsed.family);
  }));

  return (
    <svg className="rc-dial" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
      aria-label={`The solve as a stopwatch lap: ${seconds(analysis.solvingMs)} seconds, ${analysis.sliceTurns} moves`}>
      <circle cx={CENTRE} cy={CENTRE} r={OUTER + 16} className="rc-rim" />
      {analysis.steps.map((step) => {
        if (step.skipped || step.timeMs <= 0) return null;
        const start = step.cumulativeMs - step.timeMs;
        const turnFrom = start + step.recognitionMs;
        const middle = (start + step.cumulativeMs) / 2;
        const [lx, ly] = point(middle, INNER - 24);
        return (
          <g key={step.name}>
            <title>{`${step.name}: ${seconds(step.timeMs)}s · recognition ${seconds(step.recognitionMs)} · execution ${seconds(step.executionMs)} · ${step.sliceTurns} moves`}</title>
            {step.recognitionMs > gap * 2
              ? <path d={arc(start + gap, turnFrom - gap, INNER)} stroke={paleColour(step.name)} className="rc-dial-arc recognising" />
              : null}
            {step.cumulativeMs - turnFrom > gap * 2
              ? <path d={arc(turnFrom + gap, step.cumulativeMs - gap, OUTER)} stroke={stepColour(step.name)} className="rc-dial-arc turning" />
              : null}
            <text x={lx} y={ly + 4} textAnchor="middle" className="rc-label">{shortStep(step.name)}</text>
          </g>
        );
      })}
      {turns.map((move, index) => {
        const [x0, y0] = point(move.t, OUTER + 10), [x1, y1] = point(move.t, OUTER + 16);
        return <line key={index} x1={x0} y1={y0} x2={x1} y2={y1} className="rc-dial-tick" />;
      })}
      <text x={CENTRE} y={CENTRE + 6} textAnchor="middle" className="rc-dial-total mono">{seconds(analysis.solvingMs)}</text>
      <text x={CENTRE} y={CENTRE + 26} textAnchor="middle" className="rc-axis">{analysis.sliceTurns} moves</text>
    </svg>
  );
}
