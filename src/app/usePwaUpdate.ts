import { useStore } from "./useController";
import { pwaUpdates } from "./pwaUpdates";

/** Narrow update presentation; registration lives once at application startup. */
export function usePwaUpdate() {
  return { ...useStore(pwaUpdates.state), checkForUpdate: () => pwaUpdates.checkForUpdate(),
    applyUpdate: () => pwaUpdates.applyUpdate() };
}
