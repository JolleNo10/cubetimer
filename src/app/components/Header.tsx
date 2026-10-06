import { useState } from "react";
import { DEFAULT_EVENT_ID, EVENTS, eventInfo, type EventId } from "../../cube/scramble";
import { useAppState, useController, useSessionState, useSettings, useStoreValue } from "../useController";
import type { AppArea } from "../Controller";
import { Icon } from "../../shared/ui/Icon";

export function Header({
  onOpenSettings,
  onOpenConnection,
  onSelectArea,
}: {
  onOpenSettings: () => void;
  onOpenConnection?: () => void;
  onSelectArea: (area: AppArea) => void;
}) {
  const controller = useController();
  const drillRunning = useStoreValue(controller.training.state, value => value.drill.running);
  const trainingPhase = useStoreValue(controller.training.state, value => value.phase);
  const phase = useStoreValue(controller.timer.state, value => value.phase);
  const cubeStatus = useStoreValue(controller.physical.state, value => value.cubeStatus);
  const hardware = useStoreValue(controller.physical.state, value => value.hardware);
  const battery = useStoreValue(controller.physical.state, value => value.battery);
  const state = { ...useAppState(), ...useSessionState(), settings: useSettings(), phase, cubeStatus, hardware, battery };
  const [renaming, setRenaming] = useState(false);
  const session = state.sessions.find((s) => s.id === state.sessionId);
  const smartEvent = session ? eventInfo(session.event).smart : false;
  const liveTiming = state.phase === "inspection" || state.phase === "solving" || trainingPhase === "solving" || drillRunning;
  const sessionContextLocked = state.phase === "inspection" || state.phase === "solving";

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        cubetimer
      </div>

      <nav className="area-switch header-area-switch" aria-label="Application area">
        <button
          className={state.area === "timer" ? "active" : ""}
          onClick={() => onSelectArea("timer")}
        >
          Timer
        </button>
        <button className={state.area === "training" ? "active" : ""} onClick={() => onSelectArea("training")}>
          Training
        </button>
        <button className={state.area === "statistics" ? "active" : ""} onClick={() => onSelectArea("statistics")} disabled={liveTiming}>
          Statistics
        </button>
      </nav>

      {state.area === "timer" ? (
        <div className="header-context" aria-label="Timer context controls">
          <select
            value={session?.event ?? DEFAULT_EVENT_ID}
            onChange={(e) => void controller.changeEvent(e.target.value as EventId)}
            disabled={sessionContextLocked}
            aria-label="Event"
          >
            {EVENTS.filter((event) => event.id === "333").map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>

      {renaming && session ? (
        <input
          autoFocus
          defaultValue={session.name}
          className="header-session-name"
          onBlur={(e) => {
            void controller.renameSession(session.id, e.target.value.trim() || session.name);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
          aria-label="Session name"
        />
      ) : (
        <select
          className="header-session-select"
          value={state.sessionId}
          disabled={sessionContextLocked}
          onChange={(e) => {
            if (e.target.value === "__new") {
              void controller.createSession(`Session ${state.sessions.length + 1}`);
            } else {
              void controller.selectSession(e.target.value);
            }
          }}
          aria-label="Session"
        >
          {state.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__new">+ New session…</option>
        </select>
      )}

      <button
        className="ghost icon"
        onClick={() => setRenaming((r) => !r)}
        title="Rename session"
        aria-label="Rename session"
      >
        <Icon name="pencil" />
      </button>
      <button
        className="ghost danger icon"
        onClick={() => {
          if (state.sessions.length > 1 && confirm("Delete this session and its solves?")) {
            void controller.deleteSession(state.sessionId);
          }
        }}
        disabled={state.sessions.length <= 1 || sessionContextLocked}
        title="Delete session"
        aria-label="Delete session"
      >
        <Icon name="trash" />
      </button>

      <label
        className={`chip toggle${state.settings.slowSolve ? " on" : ""}`}
        title="Solve at your own pace. These solves are analysed but never timed or counted."
      >
        <input
          type="checkbox"
          checked={state.settings.slowSolve}
          onChange={(e) => void controller.updateSettings({ slowSolve: e.target.checked })}
        />
        slow solve
          </label>
        </div>
      ) : null}

      <div className="header-status">

      {state.area === "timer" && !smartEvent ? (
        <span className="chip warn header-warning">smart cube tracking is 3x3x3 only</span>
      ) : null}
      <button type="button" onClick={onOpenConnection} title="Smart cube tools" aria-label="Smart cube tools" aria-haspopup="dialog" className={`chip header-device${state.cubeStatus === "connected" ? " live" : ""}`}>
        <span className="dot" />
        <span className="header-device-name">{state.cubeStatus === "connected"
          ? (state.hardware?.deviceName ?? "cube")
          : state.cubeStatus === "connecting" ? "connecting" : "Smart cube"}</span>
        {state.cubeStatus === "connected" && state.battery !== null
          ? ` · ${state.battery}%`
          : ""}
      </button>
      <button
        className="ghost icon"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
      >
        <Icon name="settings" />
      </button>
      </div>
    </header>
  );
}
