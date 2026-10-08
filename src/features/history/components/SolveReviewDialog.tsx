import { isUsableCfopAnalysis, solveForCfopInterpretation } from "../../../app/solveAnalysis";
import { CfopAnalysisWarning } from "./CfopAnalysisQuality";
import { useDateTimeFormat } from "../../../shared/ui/useDateTimeFormat";
import { formatTime } from "../../../shared/time";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alg } from "cubing/alg";
import { TwistyPlayer } from "cubing/twisty";
import { reorientMove, rotationForCrossFace, rotationTokensBetween } from "../../../cube/orientation";
import { decodeGripTrack, rewriteWithRotations } from "../../../cube/gripTrack";
import {
  DetailedStepBreakdown,
  canPracticeTrainingStep,
  stepAt,
  type ActiveReplayAction,
} from "./StepBreakdown";
import { isTrustedCfopAnalysis, type SolveAnalysis, type SolveStep } from "../../../cube/analysis";
import { faceColour } from "../../../cube/colours";
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
import { moveGuideForToken } from "../../../cube/moveGuide";
import { CubeMoveGuide, DEFAULT_GUIDE_CAMERA, type GuideCamera } from "../../../shared/ui/CubeMoveGuide";
import { CubeFrontMarker } from "../../../shared/ui/CubeFrontMarker";
import { MoveSequence } from "../../../shared/ui/MoveSequence";
import { expandedAlgorithmMoves, handMoves } from "../../../cube/frames";
import { physicalTurns } from "../../../cube/physicalTurns";
import { SolveReviewPanel, type ReviewPreview } from "./SolveReviewPanel";

const SPEEDS = [0.25, 0.5, 1, 2];
/** An alternative has no recorded timing, so it is played at an even pace. */
const PREVIEW_MOVE_MS = 400;
/** How long the Front marker lingers after the camera stops moving. */
const FRONT_MARKER_LINGER_MS = 1200;

export type ReplayViewState = {
  index: number;
  speed: number;
};

/** An alternative being shown, and where the replay was when it was asked for. */
type Preview = ReviewPreview & { returnIndex: number };

/**
 * Review of a recorded solve: a move-by-move replay at the speed it was actually turned,
 * beside how each step went and what would have been better.
 *
 * Scrubbing forwards animates the individual turns; a jump rebuilds the state. Any
 * alternative can be played on the same cube from the moment it starts, and the replay
 * picks up where it was afterwards.
 */
export function SolveReviewDialog({
  solve: storedSolve,
  onClose,
  onTrainStep,
  initialView,
  correctionPreview,
}: {
  solve: Solve;
  onClose: () => void;
  onTrainStep?: (step: SolveStep, view: ReplayViewState) => void;
  initialView?: ReplayViewState;
  correctionPreview?: { analysis: SolveAnalysis; onApply: () => Promise<boolean> };
}) {
  const { date } = useDateTimeFormat();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const appliedRef = useRef(0);
  const initialViewRestoredRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialView?.speed ?? 1);
  const [camera, setCamera] = useState<GuideCamera>(DEFAULT_GUIDE_CAMERA);
  const [orbiting, setOrbiting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const solve = useMemo(() => solveForCfopInterpretation(storedSolve, correctionPreview?.analysis), [storedSolve, correctionPreview?.analysis]);
  const canInterpret = correctionPreview ? isTrustedCfopAnalysis(correctionPreview.analysis) : isUsableCfopAnalysis(storedSolve);
  /** Where to put the replay cursor once the cube has been rebuilt after a preview. */
  const restoreRef = useRef<number | null>(null);

  const moves = solve.moves;
  const steps = solve.analysis?.steps;

  // Replay the solve the way it was held. With a recorded grip track that is exactly
  // how it was held, rotations and all. Without one, only usable CFOP can supply
  // a Cross-frame fallback; excluded or uncertain analysis replays the raw frame.
  const crossFace = canInterpret ? solve.analysis?.crossFace : undefined;
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
  // An alternative starts from the cube as the replay showed it at that moment, and is
  // written in the grip the cube was in there.
  const previewStart = preview ? replayIndexForRawPosition(replayActions, preview.fromMove) : 0;
  const setupMoves = useMemo(
    () => (preview ? replayActions.slice(0, previewStart).map((action) => action.move) : []),
    [preview, replayActions, previewStart],
  );
  const previewActions = useMemo<ReplayAction[]>(() => {
    if (!preview) return [];
    const held = physicalTurns([...opening, ...setupMoves].join(" ")).grip;
    // Played as written when the frame it is written in is known: turn from the grip the
    // replay is in to the cross-down one, then the algorithm, rotations and wide moves
    // and all. Otherwise as the face turns the cube would report, in the replay's grip.
    const written = preview.alg && crossFace
      ? [
          ...rotationTokensBetween(held, rotationForCrossFace(crossFace).orientation).map((move) => ({ move, rotation: true })),
          ...expandedAlgorithmMoves(preview.alg).map((move) => ({ move, rotation: /^[xyz]/.test(move) })),
        ]
      : handMoves(preview.cubeMoves, held).map((move) => ({ move, rotation: false }));
    return written.map(({ move, rotation }, i) => ({
      move,
      rawIndex: -1,
      rawTimeMs: 0,
      playbackTimeMs: (i + 1) * PREVIEW_MOVE_MS,
      completesRawMove: true,
      source: rotation ? "grip-rotation" as const : "raw-turn" as const,
    }));
  }, [preview, opening, setupMoves, crossFace]);
  /** What the transport is driving: the recorded solve, or an alternative to it. */
  const actions = preview ? previewActions : replayActions;
  const visibleMoves = useMemo(() => actions.map(action => action.move), [actions]);
  const currentAction = actions[index];
  // Actions are already in the visible held frame; do not apply grip again.
  const guideMove = currentAction ? moveGuideForToken(currentAction.move) : null;
  const rawPosition = preview ? preview.fromMove : rawPositionAtReplayIndex(replayActions, index);
  const activeStep = steps ? stepAt(steps, rawPosition) : -1;
  const currentStep = steps?.[activeStep];
  const activeReplayAction: ActiveReplayAction | undefined =
    !preview && index > 0 ? replayActions[index - 1] : undefined;
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
      experimentalSetupAlg: new Alg([solve.scramble, ...opening, ...setupMoves].join(" ")),
      cameraLatitude: 27,
      cameraLongitude: 32,
      tempoScale: 6,
      alg: "",
    });
    host.appendChild(player);
    playerRef.current = player;
    appliedRef.current = 0;
    setIndex(0);
    // The move guide is a flat overlay, so it has to be told where the camera went.
    setCamera(DEFAULT_GUIDE_CAMERA);
    setOrbiting(false);
    const orbit = player.experimentalModel.twistySceneModel.orbitCoordinates;
    // The first report is just the starting camera; only later ones are the user moving it.
    let initial = true;
    let linger: ReturnType<typeof setTimeout> | undefined;
    const onOrbit = ({ latitude, longitude }: GuideCamera) => {
      setCamera({ latitude, longitude });
      if (initial) { initial = false; return; }
      setOrbiting(true);
      clearTimeout(linger);
      linger = setTimeout(() => setOrbiting(false), FRONT_MARKER_LINGER_MS);
    };
    orbit.addFreshListener(onOrbit);
    return () => {
      clearTimeout(linger);
      orbit.removeFreshListener(onOrbit);
      player.remove();
      playerRef.current = null;
    };
  }, [solve.scramble, opening, setupMoves]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.experimentalStickeringMaskOrbits = stickeringMask;
  }, [stickeringMask]);

  const seek = useCallback(
    (target: number) => {
      const player = playerRef.current;
      if (!player) return;
      const clamped = Math.max(0, Math.min(actions.length, target));
      const applied = appliedRef.current;
      if (clamped > applied && clamped - applied <= 4) {
        for (const action of actions.slice(applied, clamped)) {
          player.experimentalAddMove(action.move, { cancel: false });
        }
      } else if (clamped !== applied) {
        player.alg = new Alg(actions.slice(0, clamped).map((action) => action.move).join(" "));
        player.jumpToEnd({ flash: false });
      }
      appliedRef.current = clamped;
      setIndex(clamped);
    },
    [actions],
  );

  // Back from a preview, the cube has been rebuilt from the scramble: put the cursor
  // back where it was.
  useEffect(() => {
    if (restoreRef.current === null || preview || !playerRef.current) return;
    const target = restoreRef.current;
    restoreRef.current = null;
    seek(target);
  }, [preview, seek]);

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
    const startMs = startIndex === 0 ? 0 : actions[startIndex - 1].playbackTimeMs;
    let frame = requestAnimationFrame(function tick() {
      const elapsed = (performance.now() - startWall) * speed + startMs;
      const next = appliedRef.current;
      if (next < actions.length && actions[next].playbackTimeMs <= elapsed) {
        seek(next + 1);
      }
      if (appliedRef.current >= actions.length) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, actions, speed, seek]);

  const navigate = useCallback((target: number) => {
    setPlaying(false);
    seek(target);
  }, [seek]);

  const togglePlaying = useCallback(() => {
    if (!playing && appliedRef.current >= actions.length) seek(0);
    setPlaying(p => !p);
  }, [playing, actions.length, seek]);

  const showAlternative = useCallback((alternative: ReviewPreview) => {
    setPlaying(false);
    // The cube is rebuilt at the alternative's start, so the cursor starts there too.
    setIndex(0);
    // On a phone the cube is above the review; bring it back into view.
    hostRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setPreview((current) => ({ ...alternative, returnIndex: current ? current.returnIndex : appliedRef.current }));
  }, []);

  const endPreview = useCallback((returnTo?: number) => {
    if (!preview) return;
    setPlaying(false);
    restoreRef.current = returnTo ?? preview.returnIndex;
    setPreview(null);
  }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (preview) endPreview(); else onClose();
        return;
      }
      const target = e.target;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ||
          target instanceof HTMLElement && (target.isContentEditable ||
            target.closest("input, select, textarea, [role='textbox'], [role='slider']") ||
            e.key === " " && target.closest("button, [role='button']"))) return;
      const destination = e.key === "ArrowRight" ? index + 1
        : e.key === "ArrowLeft" ? index - 1
        : e.key === "Home" ? 0
        : e.key === "End" ? actions.length : null;
      if (destination !== null) {
        e.preventDefault();
        navigate(destination);
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlaying();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, navigate, actions.length, togglePlaying, preview, endPreview]);

  const atMs = index === 0 ? 0 : (actions[index - 1]?.playbackTimeMs ?? 0);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog wide replay-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Solve review"
      >
        <div className="dialog-head">
          <div className="row">
            <h3>{correctionPreview ? "Correction preview" : "Review"}</h3>
            <span className="mono dim">{formatTime(effectiveMs(solve))}</span>
            <span className="faint small">
              {date(solve.createdAt)}
            </span>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog-body replay-body">
        {correctionPreview ? <div className="notice" role="status" style={{ display: "block", gridColumn: "1 / -1" }}>
          <p>This is a proposed state-only reconstruction. Recorded moves, gyro/grip data and the original analysis have not been changed.</p>
          <p>Original Cross: {storedSolve.analysis ? faceColour(storedSolve.analysis.crossFace).name : "unavailable"}. Proposed Cross: {faceColour(correctionPreview.analysis.crossFace).name}.</p>
          <div className="small">Original quality issues:</div>
          {!storedSolve.analysis ? <p className="small">No original CFOP analysis was available.</p> : isTrustedCfopAnalysis(storedSolve.analysis) ? <p className="small">None recorded under current quality checks.</p> : <CfopAnalysisWarning solve={{ analysis: storedSolve.analysis }} />}
          <p>{isTrustedCfopAnalysis(correctionPreview.analysis) ? "Proposed analysis: automatically trusted under current CFOP quality checks." : "Automatic correction could not produce a reliable alternative."}</p>
          <CorrectionChanges original={storedSolve.analysis} proposed={correctionPreview.analysis} />
          {applyError ? <p role="alert">{applyError}</p> : null}
        </div> : null}
          <div className="replay-main">
          <div className="mono small dim" style={{ wordBreak: "break-word" }}>
            {solve.scramble}
          </div>
          <div className="replay-stage">
            <div ref={hostRef} className="replay-cube-host" />
            {guideMove ? <CubeMoveGuide move={guideMove} camera={camera} /> : null}
            <CubeFrontMarker camera={camera} visible={orbiting} />
          </div>
          <MoveSequence moves={visibleMoves} currentIndex={index} completedCount={index}
            onSelect={navigate} label={preview ? "Alternative moves" : "Replay moves"} layout="scroll"
            tokenKind={i => actions[i].source === "grip-rotation" ? "rotation" : undefined} />

          <div className="row replay-transport">
            <button disabled={index === 0} onClick={() => navigate(0)} title="Back to start" aria-label="Back to start">
              ⏮
            </button>
            <button onClick={() => navigate(index - 1)} disabled={index === 0} aria-label="Previous move">
              ◀
            </button>
            <button
              className="primary"
              onClick={togglePlaying}
              disabled={!actions.length}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => navigate(index + 1)} disabled={index >= actions.length} aria-label="Next move">
              ▶
            </button>
            <button onClick={() => navigate(actions.length)} disabled={index >= actions.length}
              title="Jump to end" aria-label="Jump to end">⏭</button>
            <span className="grow" />
            <span className="mono small replay-time">{formatTime(atMs)}</span>
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
            max={actions.length}
            value={index}
            onChange={(e) => {
              navigate(Number(e.target.value));
            }}
            style={{ width: "100%", padding: 0 }}
            aria-label="Move position"
          />

          {preview ? (
            <div className="row small replay-context review-preview" role="status">
              <span className="chip live"><span className="dot" />Previewing</span>
              <span>{preview.label}</span>
              <span className="dim">move {index} / {actions.length}</span>
              <span className="grow" />
              <button type="button" className="ghost small" onClick={() => endPreview()}>Back to your solve</button>
            </div>
          ) : (
            <div className="row small replay-context">
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
              {!correctionPreview && canInterpret && currentStep && onTrainStep && canPracticeTrainingStep(currentStep) ? (
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
            </div>
          )}
          </div>

          {solve.analysis ? (
            <div className="replay-steps">
              {!correctionPreview ? <CfopAnalysisWarning solve={storedSolve} /> : null}
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
                  const target = replayIndexForRawPosition(replayActions, step.fromMove);
                  if (preview) endPreview(target);
                  else navigate(target);
                }}
              />
              <div className="small faint" style={{ marginTop: 10 }}>
                Pick a step to jump to the moment it began.
              </div>
              {canInterpret ? (
                <SolveReviewPanel solve={solve} analysis={solve.analysis} activeStep={activeStep}
                  correctionPreview={!!correctionPreview}
                  onPreview={showAlternative} />
              ) : null}
            </div>
          ) : null}
        </div>
        {correctionPreview ? <div className="dialog-foot" style={{ flexShrink: 0 }}>
          <button onClick={onClose}>Cancel</button>
          {isTrustedCfopAnalysis(correctionPreview.analysis) ? <button className="primary" disabled={applying} onClick={async () => {
            setApplying(true); setApplyError(null);
            try {
              if (await correctionPreview.onApply()) onClose();
              else setApplyError("Automatic correction could not produce a reliable alternative from the current solve. Nothing was applied.");
            } catch {
              setApplyError("The correction could not be saved. Please try again.");
            } finally { setApplying(false); }
          }}>{applying ? "Applying…" : "Apply correction"}</button> : null}
        </div> : null}
      </div>
    </div>
  );
}

function CorrectionChanges({ original, proposed }: { original: SolveAnalysis | null | undefined; proposed: SolveAnalysis }) {
  if (!original) return null;
  const changes = proposed.steps.flatMap(step => {
    const before = original.steps.find(candidate => candidate.name === step.name);
    if (!before) return [];
    const changed: string[] = [];
    if (before.toMove !== step.toMove) changed.push(`${step.name} boundary: move ${before.toMove} → move ${step.toMove}`);
    if (before.case !== step.case) changed.push(`${step.name} case: ${before.case ?? "unrecognized"} → ${step.case ?? "unrecognized"}`);
    if (before.slot !== step.slot) changed.push(`${step.name} slot: ${before.slot ?? "unassigned"} → ${step.slot ?? "unassigned"}`);
    return changed;
  });
  return changes.length ? <ul className="small">{changes.map(change => <li key={change}>{change}</li>)}</ul> : null;
}
