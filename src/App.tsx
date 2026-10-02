import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsDialog } from "./components/AnalyticsDialog";
import { CoachPanel } from "./components/CoachPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { CubeView } from "./components/CubeView";
import { Training } from "./components/Training";
import { Header } from "./components/Header";
import { ReplayDialog, type ReplayViewState } from "./components/ReplayDialog";
import { ScramblePanel } from "./components/ScramblePanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { SolveList } from "./components/SolveList";
import { SolveResult } from "./components/SolveResult";
import { StatsPanel } from "./components/StatsPanel";
import { StatisticsView } from "./components/StatisticsView";
import { TimerDisplay } from "./components/TimerDisplay";
import { VIRTUAL_CUBE_KEYS } from "./components/VirtualCubeKeys";
import { useAppState, useController } from "./hooks/useController";
import type { AppArea } from "./state/controller";
import type { Solve } from "./state/types";
import { DEFAULT_EVENT_ID } from "./cube/scramble";

/** How long space must be held before a keyboard-timed solve will start. */
const HOLD_MS = 350;

type TrainingReturnView =
  | { kind: "result"; solveId: string }
  | { kind: "replay"; solveId: string; replay: ReplayViewState };

export function App() {
  const controller = useController();
  const state = useAppState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replaySolve, setReplaySolve] = useState<Solve | null>(null);
  const [replayInitialView, setReplayInitialView] = useState<ReplayViewState | null>(null);
  const [analyseSolve, setAnalyseSolve] = useState<Solve | null>(null);
  const [resultSolveId, setResultSolveId] = useState<string | null>(null);
  const [trainingReturnView, setTrainingReturnView] = useState<TrainingReturnView | null>(null);
  const [resumeTimerAfterTrainingReview, setResumeTimerAfterTrainingReview] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [holdReady, setHoldReady] = useState(false);

  const live = state.cubeStatus === "connected" || state.virtualCube;

  const resultSolve = useMemo(
    () =>
      resultSolveId
        ? state.solves.find((solve) => solve.id === resultSolveId) ?? null
        : null,
    [resultSolveId, state.solves],
  );

  const selectedSolve = useMemo(
    () => state.solves.find((s) => s.id === selectedId) ?? state.lastSolve,
    [state.solves, selectedId, state.lastSolve],
  );

  const closeResult = useCallback((options?: { resumeTimer?: boolean }) => {
    const resumeTimer = resumeTimerAfterTrainingReview && options?.resumeTimer !== false;
    setResultSolveId(null);
    setReplaySolve(null);
    setReplayInitialView(null);
    setTrainingReturnView(null);
    setResumeTimerAfterTrainingReview(false);
    if (resumeTimer) void controller.newScramble();
  }, [controller, resumeTimerAfterTrainingReview]);

  const selectArea = useCallback((area: AppArea) => {
    const returnView = trainingReturnView;
    if ((state.area === "training" || state.area === "statistics") && area === "timer" && returnView) {
      const solve = state.solves.find((candidate) => candidate.id === returnView.solveId);
      if (solve && controller.returnToTimerReview()) {
        setResultSolveId(returnView.solveId);
        setReplaySolve(returnView.kind === "replay" ? solve : null);
        setReplayInitialView(returnView.kind === "replay" ? returnView.replay : null);
        setAnalyseSolve(null);
        setResumeTimerAfterTrainingReview(true);
        return;
      }
    }

    if ((state.area === "training" && area === "statistics") || (state.area === "statistics" && area === "training")) {
      controller.setArea(area);
      return;
    }

    setTrainingReturnView(null);
    setReplayInitialView(null);
    setResumeTimerAfterTrainingReview(false);
    controller.setArea(area);
  }, [controller, state.area, state.solves, trainingReturnView]);

  useEffect(() => {
    if (
      resultSolveId !== null &&
      !state.solves.some((solve) => solve.id === resultSolveId)
    ) {
      setResultSolveId(null);
      setReplaySolve(null);
      setReplayInitialView(null);
      setTrainingReturnView(null);
      setResumeTimerAfterTrainingReview(false);
    }
  }, [resultSolveId, state.solves]);

  useEffect(() => {
    if (
      selectedId !== null &&
      !state.solves.some((solve) => solve.id === selectedId)
    ) {
      setSelectedId(null);
    }
  }, [selectedId, state.solves]);

  useEffect(() => {
    if (state.area !== "timer") {
      setResultSolveId(null);
      setReplaySolve(null);
      setAnalyseSolve(null);
    }
  }, [state.area]);

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
    if (resultSolveId !== null) {
      closeResult();
      return;
    }
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
  }, [closeResult, controller, resultSolveId, setHoldingBoth, setHoldReadyBoth]);

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
        if (resultSolveId !== null) {
          closeResult();
          return;
        }
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
  }, [closeResult, controller, pressStart, pressEnd, replaySolve, resultSolveId, settingsOpen]);

  useEffect(
    () =>
      controller.onSolveRecorded((solve) => {
        setSelectedId(null);
        setResultSolveId(solve.id);
      }),
    [controller],
  );

  useEffect(
    () => controller.onCubeMove(() => {
      if (!resumeTimerAfterTrainingReview) setResultSolveId(null);
    }),
    [controller, resumeTimerAfterTrainingReview],
  );

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
      <Header
        state={state}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectArea={selectArea}
      />

      {state.area === "training" ? <Training state={state} /> : state.area === "statistics" ? (
        <StatisticsView currentEvent={state.sessions.find((session) => session.id === state.sessionId)?.event ?? DEFAULT_EVENT_ID} activeSessionId={state.sessionId} />
      ) : <div className="app-body">
        <div className="column left">
          <ConnectionPanel state={state} />
          <SolveList
            solves={state.solves}
            selectedId={selectedSolve?.id ?? null}
            onSelect={(solve) => {
              setTrainingReturnView(null);
              setReplayInitialView(null);
              setResumeTimerAfterTrainingReview(false);
              setSelectedId(solve.id);
              setResultSolveId(solve.id);
            }}
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
          {!resultSolve ? <ScramblePanel state={state} /> : null}
          {state.settings.slowSolve && live && !resultSolve ? (
            <CoachPanel
              facelets={state.cubeFacelets}
              settings={state.settings}
              phase={state.phase}
              scramble={state.scramble}
              liveMoves={state.liveMoves}
            />
          ) : null}
          <div className="stage">
            {resultSolve ? (
              <SolveResult
                solve={resultSolve}
                solves={state.solves}
                onContinue={closeResult}
                onReplay={(solve) => {
                  setReplayInitialView(null);
                  setReplaySolve(solve);
                }}
                onAnalyse={setAnalyseSolve}
                onPracticeStep={(step) => {
                  setTrainingReturnView({ kind: "result", solveId: resultSolve.id });
                  setReplayInitialView(null);
                  setResumeTimerAfterTrainingReview(false);
                  void controller.practiceSolveStep(resultSolve, step);
                  setResultSolveId(null);
                  setReplaySolve(null);
                  setAnalyseSolve(null);
                }}
              />
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        <div className="column right">
          <StatsPanel solves={state.solves} />
        </div>
      </div>}

      {settingsOpen ? (
        <SettingsDialog settings={state.settings} onClose={() => setSettingsOpen(false)} />
      ) : null}
      {replaySolve ? (
        <ReplayDialog
          solve={replaySolve}
          initialView={replayInitialView ?? undefined}
          onClose={() => {
            setReplaySolve(null);
            setReplayInitialView(null);
          }}
          onTrainStep={(step, view) => {
            setTrainingReturnView({
              kind: "replay",
              solveId: replaySolve.id,
              replay: view,
            });
            setReplayInitialView(null);
            setResumeTimerAfterTrainingReview(false);
            void controller.practiceSolveStep(replaySolve, step);
            setReplaySolve(null);
            setResultSolveId(null);
            setAnalyseSolve(null);
          }}
        />
      ) : null}
      {analyseSolve ? (
        <AnalyticsDialog solve={analyseSolve} onClose={() => setAnalyseSolve(null)} />
      ) : null}
    </div>
  );
}
