import { formatTime } from "../../../shared/time";
import { useController, useSettings, useStore, useStoreValue } from "../../../app/useController";
import type { TimerPhase } from "../TimerRuntime";
import { effectiveMs, type Solve } from "../../../app/types";

type Props = {
  /** True while the timer or Space is held before a manually timed solve. */
  holding: boolean;
  holdReady: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
};

export function TimerDisplay({
  holding,
  holdReady,
  onPressStart,
  onPressEnd,
}: Props) {
  const controller = useController();
  const elapsed = useStore(controller.elapsed);
  const inspectionLeft = useStore(controller.inspectionLeft);
  const settings = useSettings();
  const phase = useStoreValue(controller.timer.state, state => state.phase);
  const inspectionPenalty = useStoreValue(controller.timer.state, state => state.inspectionPenalty);
  const liveMoves = useStoreValue(controller.timer.state, state => state.liveMoves);
  const offTrack = useStoreValue(controller.timer.state, state => Boolean(state.scrambleProgress && !state.scrambleProgress.onTrack));
  const lastSolve = useStoreValue(controller.sessions, state => state.lastSolve);
  const slow = settings.slowSolve;

  const smart = useStoreValue(controller.physical.state, state => state.cubeStatus === "connected" || state.virtualCube);
  let text: string;
  let tone = "waiting";

  if (phase === "inspection" && inspectionLeft !== null) {
    const left = Math.ceil(inspectionLeft / 1000);
    text = left > 0 ? String(left) : inspectionPenalty === "DNF" ? "DNF" : "+2";
    tone = inspectionPenalty === "none" ? "inspect" : "danger";
  } else if (phase === "solving") {
    // Slow solving counts moves, not seconds: the clock is not the point.
    text = slow
      ? String(liveMoves.length)
      : settings.hideTimeWhileSolving
        ? "solving"
        : formatTime(elapsed);
    tone = "running";
  } else if (phase === "finished" && lastSolve) {
    text = slow ? String(moveCount(lastSolve)) : formatTime(effectiveMs(lastSolve));
    tone = lastSolve.penalty === "DNF" ? "danger" : "running";
  } else if (holding) {
    text = formatTime(0);
    tone = holdReady ? "armed" : "danger";
  } else if (phase === "ready") {
    text = formatTime(elapsed || 0);
    tone = "armed";
  } else {
    // The next scramble loads the moment a solve is recorded, so this is what the
    // solver is looking at straight afterwards — and what they want to see is the
    // solve they just did, the same as the clock shows its last time.
    text = slow
      ? lastSolve
        ? String(moveCount(lastSolve))
        : "—"
      : formatTime(lastSolve ? effectiveMs(lastSolve) : 0);
    tone = "waiting";
  }

  // The unit belongs with a count, not with a dash.
  const showsMoves = slow && (phase === "solving" || lastSolve !== null);

  const hint = slow
    ? slowHint(phase, smart)
    : buildHint({ phase, smart, holding, holdReady, holdToStart: settings.holdToStart, offTrack });

  return (
    <div
      className="panel timer-card"
      // Tapping the timer is the only way to start one on a touch device.
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (phase === "solving" && !smart) {
          // Stopping replaces this card with Result before release. Prevent the
          // same gesture's click from activating a newly rendered Result action.
          const stage = e.currentTarget.closest<HTMLElement>(".stage");
          if (stage) preventStopClickThrough(stage, e.pointerId);
        }
        onPressStart();
      }}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "manipulation" }}
    >
      <div className={`timer-value ${tone}`} aria-live="off">
        {text}
        {showsMoves ? <span className="timer-unit">moves</span> : null}
      </div>
      <div className="timer-hint">{hint}</div>
      {phase === "solving" || phase === "finished" ? (
        <div className="timer-meta">
          <span>
            moves <b>{phase === "solving" ? liveMoves.length : (lastSolve?.moves.length ?? 0)}</b>
          </span>
          <span>
            tps{" "}
            <b>
              {formatTps(
                phase === "solving" ? liveMoves.length : (lastSolve?.moves.length ?? 0),
                phase === "solving" ? elapsed : (lastSolve?.rawMs ?? 0),
              )}
            </b>
          </span>
          {lastSolve?.penalty === "+2" && phase === "finished" ? (
            <span style={{ color: "var(--amber)" }}>+2 inspection penalty</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Keep a stop gesture's browser-generated click out of the replacement Result. */
function preventStopClickThrough(stage: HTMLElement, pointerId: number) {
  const cleanup = () => {
    stage.removeEventListener("click", suppressClick, true);
    window.removeEventListener("pointerup", released, true);
    window.removeEventListener("pointercancel", cancelled, true);
  };
  const suppressClick = (event: MouseEvent) => {
    if ("pointerId" in event && event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  };
  const released = (event: PointerEvent) => {
    // Click follows pointer-up in this dispatch; clear even if no click occurs.
    if (event.pointerId === pointerId) setTimeout(cleanup, 0);
  };
  const cancelled = (event: PointerEvent) => { if (event.pointerId === pointerId) cleanup(); };
  stage.addEventListener("click", suppressClick, true);
  window.addEventListener("pointerup", released, true);
  window.addEventListener("pointercancel", cancelled, true);
}

/** In slow solve mode nothing is being raced, so the prompts say so. */
function slowHint(phase: TimerPhase, smart: boolean) {
  switch (phase) {
    case "scrambling":
      return smart ? "Apply the scramble, then solve at your own pace" : "Slow solve";
    case "ready":
      return "Take your time — nothing is being timed";
    case "inspection":
    case "solving":
      return "Solving slowly. The breakdown is the point, not the clock.";
    case "finished":
      return "Look at the breakdown, then scramble again";
  }
}

/** How many turns a solve took, by the analysis if there is one and the raw stream if not. */
function moveCount(solve: Solve): number {
  return solve.analysis?.sliceTurns ?? solve.moves.length;
}

function formatTps(moves: number, ms: number): string {
  if (!ms || !moves) return "—";
  return ((moves / ms) * 1000).toFixed(2);
}

function buildHint({
  phase,
  smart,
  holding,
  holdReady,
  holdToStart,
  offTrack,
}: {
  phase: TimerPhase;
  smart: boolean;
  holding: boolean;
  holdReady: boolean;
  holdToStart: boolean;
  offTrack: boolean;
}) {
  if (holding) return holdReady ? "Release to start" : "Keep holding to start";
  const manualStart = <>{holdToStart ? "Hold the timer or " : "Tap the timer or press "}<kbd>Space</kbd></>;
  switch (phase) {
    case "scrambling":
      if (!smart) {
        return (
          <>
            {manualStart} to start, or connect a smart cube
          </>
        );
      }
      if (offTrack) {
        return "Cube is off the scramble — follow the fix-up below";
      }
      return "Apply the scramble to your cube";
    case "ready":
      return smart
        ? "Ready — the timer starts on your first turn"
        : <>{manualStart} to start</>;
    case "inspection":
      return smart ? "Inspecting — turn the cube to start" : <>{manualStart} to start</>;
    case "solving":
      return smart ? "Solve the cube to stop the timer" : <>Tap the timer or press <kbd>Space</kbd> to stop</>;
    case "finished":
      return smart
        ? "Scramble again for the next solve"
        : <>{manualStart} for the next solve</>;
  }
}
