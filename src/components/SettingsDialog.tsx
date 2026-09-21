import { useState } from "react";
import { forgetStoredMacs } from "../bluetooth/smartCube";
import { EVENTS } from "../cube/scramble";
import { useController } from "../hooks/useController";
import type { Settings } from "../state/types";

export function SettingsDialog({
  settings,
  onClose,
}: {
  settings: Settings;
  onClose: () => void;
}) {
  const controller = useController();
  const [progress, setProgress] = useState<string | null>(null);
  const set = (changes: Partial<Settings>) => void controller.updateSettings(changes);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="dialog-head">
          <h3>Settings</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="event">Event</label>
            <select
              id="event"
              value={settings.event}
              onChange={(e) => set({ event: e.target.value as Settings["event"] })}
            >
              {EVENTS.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                  {event.smart ? "" : " — no smart cube support"}
                </option>
              ))}
            </select>
          </div>

          <Section title="Timing">
            <Toggle
              title="WCA inspection"
              help="15 seconds, with +2 and DNF penalties."
              checked={settings.inspection}
              onChange={(inspection) => set({ inspection })}
            />
            <Toggle
              title="Start inspection automatically"
              help="Begins as soon as the cube reaches the scrambled state."
              checked={settings.autoInspection}
              disabled={!settings.inspection}
              onChange={(autoInspection) => set({ autoInspection })}
            />
            <Toggle
              title="Require the scramble to be applied"
              help="The timer only arms once the cube matches the scramble."
              checked={settings.requireScramble}
              onChange={(requireScramble) => set({ requireScramble })}
            />
            <Toggle
              title="Hold space before starting"
              help="Keyboard timing only."
              checked={settings.holdToStart}
              onChange={(holdToStart) => set({ holdToStart })}
            />
            <Toggle
              title="Hide the time while solving"
              help="Removes the pressure of a running clock."
              checked={settings.hideTimeWhileSolving}
              onChange={(hideTimeWhileSolving) => set({ hideTimeWhileSolving })}
            />
            <Toggle
              title="Sound"
              help="Inspection warnings at 8 and 12 seconds, and a tone on finishing."
              checked={settings.sound}
              onChange={(sound) => set({ sound })}
            />
          </Section>

          <Section title="Cube view">
            <div className="field">
              <label htmlFor="visualization">Visualisation</label>
              <select
                id="visualization"
                value={settings.visualization}
                onChange={(e) =>
                  set({ visualization: e.target.value as Settings["visualization"] })
                }
              >
                <option value="3D">3D</option>
                <option value="2D">Flat net</option>
                <option value="off">Off</option>
              </select>
            </div>
            <Toggle
              title="Back view"
              help="Shows the three hidden faces alongside the cube."
              checked={settings.showBackView}
              disabled={settings.visualization !== "3D"}
              onChange={(showBackView) => set({ showBackView })}
            />
            <Toggle
              title="Follow the cube's gyroscope"
              help="Turns the 3D cube as you turn the real one. Needs a cube with a gyroscope."
              checked={settings.useGyroscope}
              disabled={settings.visualization !== "3D"}
              onChange={(useGyroscope) => set({ useGyroscope })}
            />
            <Toggle
              title="Light theme"
              checked={settings.theme === "light"}
              onChange={(light) => set({ theme: light ? "light" : "dark" })}
            />
          </Section>

          <Section title="Your data">
            <div className="small faint" style={{ margin: "6px 0 10px" }}>
              Solves are stored in this browser only. Everything here merges by solve
              id, so importing the same file twice will not duplicate anything.
            </div>
            <div className="row wrap">
              <button onClick={() => void exportSolves(controller)}>Export JSON</button>
              <label className="row" style={{ cursor: "pointer" }}>
                <span className="chip">Import JSON…</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importSolves(controller, file);
                  }}
                />
              </label>
            </div>

            <div className="row wrap" style={{ marginTop: 10 }}>
              <button onClick={() => void exportCsv(controller, "session")}>
                Export session CSV
              </button>
              <button onClick={() => void exportCsv(controller, "all")}>
                Export all CSV
              </button>
              <label className="row" style={{ cursor: "pointer" }}>
                <span className="chip">Import CSV…</span>
                <input
                  type="file"
                  accept="text/csv,.csv"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importCsv(controller, file, setProgress);
                  }}
                />
              </label>
            </div>
            <div className="small faint" style={{ marginTop: 6 }}>
              CSV uses the full solve analysis format — every step, case, turn count and
              timestamp — so solves move between the two without losing anything.
            </div>
            {progress ? (
              <div className="small" style={{ marginTop: 8 }}>
                {progress}
              </div>
            ) : null}
          </Section>

          <Section title="Bluetooth">
            <div className="row">
              <div className="grow small faint">
                Cube MAC addresses are remembered so you are not asked again.
              </div>
              <button onClick={() => forgetStoredMacs()}>Forget saved cubes</button>
            </div>
          </Section>
        </div>
        <div className="dialog-foot">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

async function exportSolves(controller: ReturnType<typeof useController>) {
  download(
    `cubetimer-${new Date().toISOString().slice(0, 10)}.json`,
    await controller.exportData(),
    "application/json",
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportCsv(
  controller: ReturnType<typeof useController>,
  scope: "session" | "all",
) {
  const csv = await controller.exportSolveCsv(scope);
  download(`solves-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
}

async function importCsv(
  controller: ReturnType<typeof useController>,
  file: File,
  setProgress: (value: string | null) => void,
) {
  setProgress("Reading file…");
  try {
    const result = await controller.importSolveCsv(
      await file.text(),
      (done, total) => setProgress(`Imported ${done} of ${total} solves…`),
    );
    setProgress(
      `Imported ${result.solves} solves across ${result.sessions} sessions.`,
    );
  } catch (error) {
    setProgress(`Could not import that file: ${String(error)}`);
  }
}

async function importSolves(
  controller: ReturnType<typeof useController>,
  file: File,
) {
  try {
    const result = await controller.importData(await file.text());
    alert(`Imported ${result.solves} solves across ${result.sessions} sessions.`);
  } catch (error) {
    alert(`Could not import that file: ${String(error)}`);
  }
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="panel-title" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  title,
  help,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switch-row" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span>
        <span className="title">{title}</span>
        {help ? <span className="help" style={{ display: "block" }}>{help}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
      />
    </label>
  );
}
