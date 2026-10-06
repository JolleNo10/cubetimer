import { applySolveThreshold } from "../features/statistics/state/solveThreshold";
import { createContext, useContext, useSyncExternalStore, useMemo } from "react";
import type { Controller } from "./Controller";
import type { Store } from "../shared/store";

export const ControllerContext = createContext<Controller | null>(null);

export function useController(): Controller {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("Controller is not available");
  return controller;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get.bind(store), store.get.bind(store));
}

export function useAppState() {
  return useStore(useController().state);
}

export function useTrainingState() {
  return useStore(useController().training.state);
}

export function useTimerState() { return useStore(useController().timer.state); }
export function useCubeState() { return useStore(useController().physical.state); }
export function useSolveThresholdSettings() {
  const controller = useController();
  const slowSolveThreshold = useStoreValue(controller.settings, settings => settings.slowSolveThreshold);
  const slowSolveHandling = useStoreValue(controller.settings, settings => settings.slowSolveHandling);
  return useMemo(() => ({ slowSolveThreshold, slowSolveHandling }), [slowSolveThreshold, slowSolveHandling]);
}

export function useSessionState() {
  const state = useStore(useController().sessions);
  const threshold = useSolveThresholdSettings();
  return useMemo(() => {
    const solves = applySolveThreshold(state.solves, threshold);
    return { ...state, solves, lastSolve: state.lastSolve ? solves.find(solve => solve.id === state.lastSolve!.id) ?? state.lastSolve : null };
  }, [state, threshold]);
}
export function useSettings() { return useStore(useController().settings); }

/** Select stable facts without subscribing a consumer to unrelated move updates. */
export function useStoreValue<T, V>(store: Store<T>, select: (value: T) => V): V {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
