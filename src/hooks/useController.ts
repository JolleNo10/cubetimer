import { createContext, useContext, useSyncExternalStore } from "react";
import type { Controller } from "../state/controller";
import type { Store } from "../state/store";

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
