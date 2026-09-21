import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alg } from "cubing/alg";
import { TwistyPlayer } from "cubing/twisty";
import { reorientMove, rotationForCrossFace } from "../cube/orientation";
import { formatTime } from "../state/stats";
import { StepBreakdown, stepAt } from "./StepBreakdown";
import { effectiveMs, type Solve } from "../state/types";

const SPEEDS = [0.25, 0.5, 1, 2];

/**
 * Move-by-move replay of a recorded solve, at the speed it was actually turned.
 * Scrubbing forwards animates the individual turns; a jump rebuilds the state.
 */
export function ReplayDialog({
  solve,
  onClose,
}: {
  solve: Solve;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const appliedRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const moves = solve.moves;
  const steps = solve.analysis?.steps;

  // Replay the solve the way it was held: the cross face underneath, as the solver
  // had it. Turning the cube over means relabelling the moves so they still act on
  // the faces they did at the time.
  const crossFace = solve.analysis?.crossFace;
  const grip = useMemo(
    () => (crossFace ? rotationForCrossFace(crossFace) : null),
    [crossFace],
  );
  const asHeld = useCallback(
    (move: string) => (grip ? reorientMove(move, grip.orientation) : move),
    [grip],
  );
  const activeStep = steps ? stepAt(steps, index) : -1;
  const currentStep = steps?.[activeStep];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const player = new TwistyPlayer({
      puzzle: "3x3x3",
      visualization: "PG3D",
      background: "none",
      controlPanel: "none",
      hintFacelets: "floating",
      backView: "top-right",
      experimentalSetupAnchor: "start",
      experimentalSetupAlg: grip
        ? new Alg(solve.scramble).concat(new Alg(grip.tokens.join(" ")))
        : solve.scramble,
      cameraLatitude: 27,
      cameraLongitude: -32,
      tempoScale: 6,
      alg: "",
    });
    host.appendChild(player);
    playerRef.current = player;
    appliedRef.current = 0;
    return () => {
      player.remove();
      playerRef.current = null;
    };
  }, [solve.scramble, grip]);

  const seek = useCallback(
    (target: number) => {
      const player = playerRef.current;
      if (!player) return;
      const clamped = Math.max(0, Math.min(moves.length, target));
      const applied = appliedRef.current;
      if (clamped > applied && clamped - applied <= 4) {
        for (let i = applied; i < clamped; i++) {
          player.experimentalAddMove(asHeld(moves[i].move), { cancel: false });
        }
      } else if (clamped !== applied) {
        player.alg = new Alg(
          moves
            .slice(0, clamped)
            .map((m) => asHeld(m.move))
            .join(" "),
        );
        player.jumpToEnd({ flash: false });
      }
      appliedRef.current = clamped;
      setIndex(clamped);
    },
    [moves, asHeld],
  );

  // Playback follows the recorded timestamps, so pauses and bursts look like they did.
  // The loop runs off refs rather than state, so applying a move does not restart it.
  useEffect(() => {
    if (!playing) return;
    const startIndex = appliedRef.current;
    const startWall = performance.now();
    const startMs = startIndex === 0 ? 0 : moves[startIndex - 1].t;
    let frame = requestAnimationFrame(function tick() {
      const elapsed = (performance.now() - startWall) * speed + startMs;
      let next = appliedRef.current;
      while (next < moves.length && moves[next].t <= elapsed) next++;
      if (next !== appliedRef.current) seek(next);
      if (appliedRef.current >= moves.length) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, moves, speed, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") seek(index + 1);
      if (e.key === "ArrowLeft") seek(index - 1);
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, seek]);

  const atMs = index === 0 ? 0 : moves[index - 1].t;

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Solve replay"
      >
        <div className="dialog-head">
          <div className="row">
            <h3>Replay</h3>
            <span className="mono dim">{formatTime(effectiveMs(solve))}</span>
            <span className="faint small">
              {new Date(solve.createdAt).toLocaleString()}
            </span>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog-body replay-body">
          <div className="replay-main">
          <div className="mono small dim" style={{ wordBreak: "break-word" }}>
            {solve.scramble}
          </div>
          <div ref={hostRef} style={{ height: 300 }} />

          <div className="row">
            <button onClick={() => seek(0)} title="Back to start">
              ⏮
            </button>
            <button onClick={() => seek(index - 1)} disabled={index === 0}>
              ◀
            </button>
            <button
              className="primary"
              onClick={() => {
                // Starting again from the end replays the solve from the top.
                if (!playing && appliedRef.current >= moves.length) seek(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => seek(index + 1)} disabled={index >= moves.length}>
              ▶
            </button>
            <span className="grow" />
            <span className="mono small">{formatTime(atMs)}</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </div>

          <input
            type="range"
            min={0}
            max={moves.length}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              seek(Number(e.target.value));
            }}
            style={{ width: "100%", padding: 0 }}
            aria-label="Move position"
          />

          <div className="row small">
            <span className="dim">
              move {index} / {moves.length}
            </span>
            {currentStep ? (
              <>
                <span className="faint">·</span>
                <span className="dim">
                  {currentStep.name}
                  {currentStep.case ? ` · ${currentStep.case}` : ""}
                </span>
              </>
            ) : null}
            <span className="grow" />
            <span className="mono faint" style={{ wordBreak: "break-word" }}>
              {moves
                .slice(Math.max(0, index - 8), index)
                .map((m) => m.move)
                .join(" ")}
            </span>
          </div>
          </div>

          {solve.analysis ? (
            <div className="replay-steps">
              <div className="panel-title" style={{ marginBottom: 8 }}>
                Breakdown
              </div>
              <StepBreakdown
                analysis={solve.analysis}
                activeStep={activeStep}
                position={index}
                showDetail={false}
                // Jumping to a step means the state it started from: click F2L Slot 1
                // and the cross is done with the first pair still to come.
                onSelectStep={(step) => {
                  setPlaying(false);
                  seek(step.fromMove);
                }}
              />
              <div className="small faint" style={{ marginTop: 10 }}>
                Pick a step to jump to the moment it began.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
