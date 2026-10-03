import { createContext, useContext, useSyncExternalStore } from "react";
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
export function useSessionState() { return useStore(useController().sessions); }
export function useSettings() { return useStore(useController().settings); }

/** Select stable facts without subscribing a consumer to unrelated move updates. */
export function useStoreValue<T, V>(store: Store<T>, select: (value: T) => V): V {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
