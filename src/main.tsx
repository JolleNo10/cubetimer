// Must come before anything touches cubing.js search.
import "./cube/searchConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ControllerContext } from "./hooks/useController";
import { Controller } from "./state/controller";
import "./styles/global.css";

const controller = new Controller();
void controller.init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ControllerContext.Provider value={controller}>
      <App />
    </ControllerContext.Provider>
  </StrictMode>,
);
