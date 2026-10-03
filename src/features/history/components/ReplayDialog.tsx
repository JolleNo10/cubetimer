import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alg } from "cubing/alg";
import { TwistyPlayer } from "cubing/twisty";
import { reorientMove, rotationForCrossFace } from "../../../cube/orientation";
import { decodeGripTrack, rewriteWithRotations } from "../../../cube/gripTrack";
import { formatTime } from "../../statistics/state/stats";
import {
  DetailedStepBreakdown,
  canPracticeTrainingStep,
  stepAt,
  type ActiveReplayAction,
} from "./StepBreakdown";
import type { SolveStep } from "../../../cube/analysis";
import {
  NORMAL_REPLAY_STICKERING_MASK,
  replayStickeringMask,
} from "./replayFocus";
import {
  buildReplayTimeline,
  rawPositionAtReplayIndex,
  replayIndexForRawPosition,
  type ReplayAction,
} from "./replayTimeline";
import { effectiveMs, type Solve } from "../../../app/types";

const SPEEDS = [0.25, 0.5, 1, 2];

export type ReplayViewState = {
  index: number;
  speed: number;
};

/**
 * Move-by-move replay of a recorded solve, at the speed it was actually turned.
 * Scrubbing forwards animates the individual turns; a jump rebuilds the state.
 */
export function ReplayDialog({
  solve,
  onClose,
  onTrainStep,
  initialView,
}: {
  solve: Solve;
  onClose: () => void;
  onTrainStep?: (step: SolveStep, view: ReplayViewState) => void;
  initialView?: ReplayViewState;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const appliedRef = useRef(0);
  const initialViewRestoredRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialView?.speed ?? 1);

  const moves = solve.moves;
  const steps = solve.analysis?.steps;

  // Replay the solve the way it was held. With a recorded grip track that is exactly
  // how it was held, rotations and all; without one, all that is known is which face
  // the cross went on, so the cube is turned once and left there.
  const crossFace = solve.analysis?.crossFace;
  const track = useMemo(
    () => (solve.gripTrack ? decodeGripTrack(solve.gripTrack) : null),
    [solve.gripTrack],
  );
  const grip = useMemo(
    () => (track || !crossFace ? null : rotationForCrossFace(crossFace)),
    [track, crossFace],
  );
  /** The turn the cube starts the replay in, before any move. */
  const opening = useMemo(
    () => (track ? [...track.inspection] : (grip?.tokens ?? [])),
    [track, grip],
  );

  /**
   * The moves to show for a stretch of the solve, as the solver turned them.
   *
   * `held` is the grip the cube is already in, so a rotation made between one move
   * and the next belongs to the stretch it starts and is not lost at the seam.
   */
  const asHeld = useCallback(
    (from: number, to: number): string[] => {
      if (track) {
        return rewriteWithRotations(
          moves.slice(from, to),
          track.orientations.slice(from, to),
          from > 0 ? (track.orientations[from - 1] ?? null) : null,
        ).map((m) => m.move);
      }
      return moves
        .slice(from, to)
        .map((m) => (grip ? reorientMove(m.move, grip.orientation) : m.move));
    },
    [track, grip, moves],
  );
  const replayActions = useMemo<ReplayAction[]>(
    () => buildReplayTimeline(
      moves.map((_, rawIndex) => asHeld(rawIndex, rawIndex + 1)),
      moves,
    ),
    [asHeld, moves],
  );
  const rawPosition = rawPositionAtReplayIndex(replayActions, index);
  const activeStep = steps ? stepAt(steps, rawPosition) : -1;
  const currentStep = steps?.[activeStep];
  const activeReplayAction: ActiveReplayAction | undefined =
    index > 0 ? replayActions[index - 1] : undefined;
  const stickeringMask = solve.analysis
    ? replayStickeringMask(solve.analysis, activeStep)
    : NORMAL_REPLAY_STICKERING_MASK;

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
      experimentalSetupAlg: opening.length
        ? new Alg(solve.scramble).concat(new Alg(opening.join(" ")))
        : new Alg(solve.scramble),
      cameraLatitude: 27,
      cameraLongitude: 32,
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
  }, [solve.scramble, opening]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.experimentalStickeringMaskOrbits = stickeringMask;
  }, [stickeringMask]);

  const seek = useCallback(
    (target: number) => {
      const player = playerRef.current;
      if (!player) return;
      const clamped = Math.max(0, Math.min(replayActions.length, target));
      const applied = appliedRef.current;
      if (clamped > applied && clamped - applied <= 4) {
        for (const action of replayActions.slice(applied, clamped)) {
          player.experimentalAddMove(action.move, { cancel: false });
        }
      } else if (clamped !== applied) {
        player.alg = new Alg(replayActions.slice(0, clamped).map((action) => action.move).join(" "));
        player.jumpToEnd({ flash: false });
      }
      appliedRef.current = clamped;
      setIndex(clamped);
    },
    [replayActions],
  );

  useEffect(() => {
    if (!initialView || initialViewRestoredRef.current || !playerRef.current) return;
    initialViewRestoredRef.current = true;
    setPlaying(false);
    seek(initialView.index);
  }, [initialView, seek]);

  // Playback follows the recorded timestamps, so pauses and bursts look like they did.
  // The loop runs off refs rather than state, so applying a move does not restart it.
  useEffect(() => {
    if (!playing) return;
    const startIndex = appliedRef.current;
    const startWall = performance.now();
    const startMs = startIndex === 0 ? 0 : replayActions[startIndex - 1].playbackTimeMs;
    let frame = requestAnimationFrame(function tick() {
      const elapsed = (performance.now() - startWall) * speed + startMs;
      const next = appliedRef.current;
      if (next < replayActions.length && replayActions[next].playbackTimeMs <= elapsed) {
        seek(next + 1);
      }
      if (appliedRef.current >= replayActions.length) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, replayActions, speed, seek]);

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

  const atMs = index === 0 ? 0 : replayActions[index - 1].playbackTimeMs;

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog wide replay-dialog"
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
                if (!playing && appliedRef.current >= replayActions.length) seek(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => seek(index + 1)} disabled={index >= replayActions.length}>
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
            max={replayActions.length}
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
              move {index} / {replayActions.length}
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
            {currentStep && onTrainStep && canPracticeTrainingStep(currentStep) ? (
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  setPlaying(false);
                  onTrainStep(currentStep, { index, speed });
                }}
              >
                Train this {currentStep.name.startsWith("F2L") ? "F2L" : currentStep.name}
              </button>
            ) : null}
            <span className="grow" />
            <span className="mono faint" style={{ wordBreak: "break-word" }}>
              {replayActions
                .slice(Math.max(0, index - 8), index)
                .map((action) => action.move)
                .join(" ")}
            </span>
          </div>
          </div>

          {solve.analysis ? (
            <div className="replay-steps">
              <div className="panel-title" style={{ marginBottom: 8 }}>
                Breakdown
              </div>
              <DetailedStepBreakdown
                analysis={solve.analysis}
                activeStep={activeStep}
                activeReplayAction={activeReplayAction}
                // Jumping to a step means the state it started from: click F2L Slot 1
                // and the cross is done with the first pair still to come.
                onSelectStep={(step) => {
                  setPlaying(false);
                  seek(replayIndexForRawPosition(replayActions, step.fromMove));
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
