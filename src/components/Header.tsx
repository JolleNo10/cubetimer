import { useState } from "react";
import { EVENTS, eventInfo } from "../cube/scramble";
import { useController } from "../hooks/useController";
import type { AppState } from "../state/controller";
import type { EventId } from "../cube/scramble";
import { Icon } from "./Icon";

export function Header({
  state,
  onOpenSettings,
}: {
  state: AppState;
  onOpenSettings: () => void;
}) {
  const controller = useController();
  const [renaming, setRenaming] = useState(false);
  const session = state.sessions.find((s) => s.id === state.sessionId);
  const smartEvent = eventInfo(state.settings.event).smart;

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        cubetimer
      </div>

      <select
        value={state.settings.event}
        onChange={(e) => void controller.updateSettings({ event: e.target.value as EventId })}
        aria-label="Event"
      >
        {EVENTS.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name}
          </option>
        ))}
      </select>

      {renaming && session ? (
        <input
          autoFocus
          defaultValue={session.name}
          style={{ width: 160 }}
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
          value={state.sessionId}
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
        disabled={state.sessions.length <= 1}
        title="Delete session"
        aria-label="Delete session"
      >
        <Icon name="trash" />
      </button>

      <span className="header-spacer" />

      {!smartEvent ? (
        <span className="chip warn">smart cube tracking is 3x3x3 only</span>
      ) : null}
      <span className={`chip${state.cubeStatus === "connected" ? " live" : ""}`}>
        <span className="dot" />
        {state.cubeStatus === "connected"
          ? (state.hardware?.deviceName ?? "cube")
          : "no cube"}
        {state.cubeStatus === "connected" && state.battery !== null
          ? ` · ${state.battery}%`
          : ""}
      </span>
      <button
        className="ghost icon"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
      >
        <Icon name="settings" />
      </button>
    </header>
  );
}
