// Must come before anything touches cubing.js search.
import "./cube/searchConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ControllerContext } from "./app/useController";
import { Controller } from "./app/Controller";
import { installDebugConsole } from "./util/debug";
import "./styles/global.css";
import { pwaUpdates, cleanupDevelopmentWorker } from "./app/pwaUpdates";
import { requestPersistentStorage } from "./infrastructure/persistence/storagePersistence";

const controller = new Controller();
// Storage enrollment and asset delivery never gate IndexedDB initialization.
void requestPersistentStorage(navigator.storage);
if (import.meta.env.PROD) {
  void pwaUpdates.register(navigator.serviceWorker, () => controller.canReloadForUpdate());
  window.addEventListener("online", () => { void pwaUpdates.checkForUpdate(); });
} else {
  pwaUpdates.development();
  void cleanupDevelopmentWorker(navigator.serviceWorker);
}
// `cubeDebug.grip()` turns the trace on; `cubeDebug.cubetimer` is the controller
// itself, for asking it things directly while working out why a reading looks wrong.
installDebugConsole({ cubetimer: controller });
// init publishes storage failures through the Controller error Store.
void controller.init().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ControllerContext.Provider value={controller}>
      <App />
    </ControllerContext.Provider>
  </StrictMode>,
);
