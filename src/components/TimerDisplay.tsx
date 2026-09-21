import { useController, useStore } from "../hooks/useController";
import { formatTime } from "../state/stats";
import type { AppState } from "../state/controller";
import { effectiveMs } from "../state/types";

type Props = {
  state: AppState;
  /** True while the space bar is held down before a keyboard-timed solve. */
  holding: boolean;
  holdReady: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
};

export function TimerDisplay({
  state,
  holding,
  holdReady,
  onPressStart,
  onPressEnd,
}: Props) {
  const controller = useController();
  const elapsed = useStore(controller.elapsed);
  const inspectionLeft = useStore(controller.inspectionLeft);
  const { phase, settings, lastSolve } = state;
  const slow = settings.slowSolve;

  const smart = state.cubeStatus === "connected" || state.virtualCube;
  let text: string;
  let tone = "waiting";

  if (phase === "inspection" && inspectionLeft !== null) {
    const left = Math.ceil(inspectionLeft / 1000);
    text = left > 0 ? String(left) : state.inspectionPenalty === "DNF" ? "DNF" : "+2";
    tone = state.inspectionPenalty === "none" ? "inspect" : "danger";
  } else if (phase === "solving") {
    // Slow solving counts moves, not seconds: the clock is not the point.
    text = slow
      ? String(state.liveMoves.length)
      : settings.hideTimeWhileSolving
        ? "solving"
        : formatTime(elapsed);
    tone = "running";
  } else if (phase === "finished" && lastSolve) {
    text = slow
      ? String(lastSolve.analysis?.sliceTurns ?? lastSolve.moves.length)
      : formatTime(effectiveMs(lastSolve));
    tone = lastSolve.penalty === "DNF" ? "danger" : "running";
  } else if (holding) {
    text = formatTime(0);
    tone = holdReady ? "armed" : "danger";
  } else if (phase === "ready") {
    text = formatTime(elapsed || 0);
    tone = "armed";
  } else {
    text = slow ? "—" : formatTime(lastSolve ? effectiveMs(lastSolve) : 0);
    tone = "waiting";
  }

  const hint = slow
    ? slowHint(phase, smart)
    : buildHint({ phase, smart, holding, state });

  return (
    <div
      className="panel timer-card"
      // Tapping the timer is the only way to start one on a touch device.
      onPointerDown={(e) => {
        if (e.button === 0) onPressStart();
      }}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "manipulation" }}
    >
      <div className={`timer-value ${tone}`} aria-live="off">
        {text}
        {slow && (phase === "solving" || phase === "finished") ? (
          <span className="timer-unit">moves</span>
        ) : null}
      </div>
      <div className="timer-hint">{hint}</div>
      {phase === "solving" || phase === "finished" ? (
        <div className="timer-meta">
          <span>
            moves <b>{phase === "solving" ? state.liveMoves.length : (lastSolve?.moves.length ?? 0)}</b>
          </span>
          <span>
            tps{" "}
            <b>
              {formatTps(
                phase === "solving" ? state.liveMoves.length : (lastSolve?.moves.length ?? 0),
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

/** In slow solve mode nothing is being raced, so the prompts say so. */
function slowHint(phase: AppState["phase"], smart: boolean) {
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

function formatTps(moves: number, ms: number): string {
  if (!ms || !moves) return "—";
  return ((moves / ms) * 1000).toFixed(2);
}

function buildHint({
  phase,
  smart,
  holding,
  state,
}: {
  phase: AppState["phase"];
  smart: boolean;
  holding: boolean;
  state: AppState;
}) {
  if (holding) return "Release to start";
  switch (phase) {
    case "scrambling":
      if (!smart) {
        return (
          <>
            Hold <kbd>space</kbd> to start, or connect a smart cube
          </>
        );
      }
      if (state.scrambleProgress && !state.scrambleProgress.onTrack) {
        return "Cube is off the scramble — follow the fix-up below";
      }
      return "Apply the scramble to your cube";
    case "ready":
      return smart
        ? "Ready — the timer starts on your first turn"
        : <>Hold <kbd>space</kbd> to start</>;
    case "inspection":
      return smart ? "Inspecting — turn the cube to start" : <>Press <kbd>space</kbd> to start</>;
    case "solving":
      return smart ? "Solve the cube to stop the timer" : <>Press <kbd>space</kbd> to stop</>;
    case "finished":
      return smart
        ? "Scramble again for the next solve"
        : <>Press <kbd>space</kbd> for the next solve</>;
  }
}
