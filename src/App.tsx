import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { AnalyticsDialog } from "./components/AnalyticsDialog";
import { CoachPanel } from "./components/CoachPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { CubeView } from "./components/CubeView";
import { Header } from "./components/Header";
import { ReplayDialog } from "./components/ReplayDialog";
import { ScramblePanel } from "./components/ScramblePanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { SolveDetail } from "./components/SolveDetail";
import { SolveList } from "./components/SolveList";
import { StatsPanel } from "./components/StatsPanel";
import { TimerDisplay } from "./components/TimerDisplay";
import { VIRTUAL_CUBE_KEYS } from "./components/VirtualCubeKeys";
import { useAppState, useController } from "./hooks/useController";
import type { Solve } from "./state/types";

/** How long space must be held before a keyboard-timed solve will start. */
const HOLD_MS = 350;

export function App() {
  const controller = useController();
  const state = useAppState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replaySolve, setReplaySolve] = useState<Solve | null>(null);
  const [analyseSolve, setAnalyseSolve] = useState<Solve | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [holdReady, setHoldReady] = useState(false);

  const live = state.cubeStatus === "connected" || state.virtualCube;

  const selectedSolve = useMemo(
    () => state.solves.find((s) => s.id === selectedId) ?? state.lastSolve,
    [state.solves, selectedId, state.lastSolve],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  /**
   * Starting a solve by hand: hold, then release. Shared by the space bar and by
   * tapping the timer, so the app works on a phone with no keyboard.
   */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hold state lives in refs as well as state: the handlers must not put side effects
  // inside a React updater, and they must see the current value without re-binding.
  const holdingRef = useRef(false);
  const holdReadyRef = useRef(false);

  const setHoldingBoth = useCallback((value: boolean) => {
    holdingRef.current = value;
    setHolding(value);
  }, []);

  const setHoldReadyBoth = useCallback((value: boolean) => {
    holdReadyRef.current = value;
    setHoldReady(value);
  }, []);

  const pressStart = useCallback(() => {
    const current = controller.state.get();
    if (current.phase === "solving") {
      // A solve the cube started is stopped by solving the cube, not by a key or a tap.
      if (current.solveSource === "keyboard") controller.startFromKeyboard();
      return;
    }
    if (controller.hasCube || holdingRef.current) return;
    setHoldingBoth(true);
    if (current.settings.holdToStart) {
      setHoldReadyBoth(false);
      holdTimer.current = setTimeout(() => setHoldReadyBoth(true), HOLD_MS);
    } else {
      setHoldReadyBoth(true);
    }
  }, [controller, setHoldingBoth, setHoldReadyBoth]);

  const pressEnd = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (!holdingRef.current) return;
    setHoldingBoth(false);
    const ready = holdReadyRef.current;
    setHoldReadyBoth(false);
    if (ready) controller.startFromKeyboard();
  }, [controller, setHoldingBoth, setHoldReadyBoth]);

  useEffect(() => {
    if (replaySolve || settingsOpen) return;

    /** Text fields swallow every key; a focused checkbox should only swallow space. */
    const isTextEntry = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
      if (target instanceof HTMLInputElement) {
        return !["checkbox", "radio", "button", "submit", "range"].includes(target.type);
      }
      return false;
    };

    const isToggle = (target: EventTarget | null) =>
      (target instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(target.type)) ||
      target instanceof HTMLButtonElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if (event.key === "Escape") {
        controller.cancel();
        return;
      }
      if (controller.state.get().virtualCube && !event.metaKey && !event.ctrlKey) {
        const move = VIRTUAL_CUBE_KEYS[event.key.toLowerCase()];
        if (move) {
          event.preventDefault();
          controller.injectMove(move);
          return;
        }
      }
      // Space is how a focused checkbox or button is activated; leave it to them.
      if (event.key !== " " || isToggle(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      pressStart();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || isTextEntry(event.target) || isToggle(event.target)) return;
      pressEnd();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controller, pressStart, pressEnd, replaySolve, settingsOpen]);

  if (!state.ready) {
    return (
      <div className="app">
        <div className="empty" style={{ marginTop: "20vh" }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header state={state} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="app-body">
        <div className="column left">
          <ConnectionPanel state={state} />
          <SolveList
            solves={state.solves}
            selectedId={selectedSolve?.id ?? null}
            onSelect={(solve) => setSelectedId(solve.id)}
          />
        </div>

        <div className="column">
          {state.error ? (
            <div className="notice error">
              <span className="grow">{state.error}</span>
              <button className="ghost" onClick={() => controller.dismissError()}>
                Dismiss
              </button>
            </div>
          ) : null}
          <ScramblePanel state={state} />
          {state.settings.slowSolve && live ? (
            <CoachPanel
              facelets={state.cubeFacelets}
              settings={state.settings}
              phase={state.phase}
              scramble={state.scramble}
              liveMoves={state.liveMoves}
            />
          ) : null}
          <div className="stage">
            <TimerDisplay
              state={state}
              holding={holding}
              holdReady={holdReady}
              onPressStart={pressStart}
              onPressEnd={pressEnd}
            />
            <CubeView
              settings={state.settings}
              facelets={state.cubeFacelets}
              gyroSupported={state.hardware?.gyroSupported ?? false}
              live={live}
              scramble={state.scramble}
            />
          </div>
        </div>

        <div className="column right">
          <StatsPanel solves={state.solves} />
          <AnalysisPanel
            solve={selectedSolve}
            onReplay={setReplaySolve}
            onAnalyse={setAnalyseSolve}
          />
          {selectedSolve ? <SolveDetail solve={selectedSolve} /> : null}
        </div>
      </div>

      {settingsOpen ? (
        <SettingsDialog settings={state.settings} onClose={() => setSettingsOpen(false)} />
      ) : null}
      {replaySolve ? (
        <ReplayDialog solve={replaySolve} onClose={() => setReplaySolve(null)} />
      ) : null}
      {analyseSolve ? (
        <AnalyticsDialog solve={analyseSolve} onClose={() => setAnalyseSolve(null)} />
      ) : null}
    </div>
  );
}
