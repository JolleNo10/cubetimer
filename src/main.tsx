// Must come before anything touches cubing.js search.
import "./cube/searchConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ControllerContext } from "./app/useController";
import { Controller } from "./app/Controller";
import { installDebugConsole } from "./util/debug";
import "./styles/global.css";

const controller = new Controller();
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
