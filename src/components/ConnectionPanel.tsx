import { useState } from "react";
import { bluetoothAvailable } from "../bluetooth/smartCube";
import { useController } from "../hooks/useController";
import type { AppState } from "../state/controller";
import { VIRTUAL_CUBE_HELP } from "./VirtualCubeKeys";

/** Connection state, battery and hardware details for the smart cube. */
export function ConnectionPanel({ state }: { state: AppState }) {
  const controller = useController();
  const [macRequest, setMacRequest] = useState<{
    deviceName: string;
    resolve: (mac: string | null) => void;
  } | null>(null);
  const [macInput, setMacInput] = useState("");

  const connect = () =>
    void controller.connect(
      (deviceName) =>
        new Promise<string | null>((resolve) => {
          setMacInput("");
          setMacRequest({ deviceName, resolve });
        }),
    );

  const { cubeStatus, hardware, battery } = state;
  const supported = bluetoothAvailable();

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Smart cube</span>
        <span className={`chip${cubeStatus === "connected" ? " live" : ""}`}>
          <span className="dot" />
          {cubeStatus === "connected"
            ? "connected"
            : cubeStatus === "connecting"
              ? "connecting…"
              : supported
                ? "not connected"
                : "unavailable"}
        </span>
      </div>
      <div className="panel-body" style={{ gap: 10, display: "flex", flexDirection: "column" }}>
        {!supported ? (
          <div className="small faint">
            Web Bluetooth is not available in this browser. Chrome, Edge or Bluefy on a
            device with Bluetooth will work.
          </div>
        ) : cubeStatus === "connected" ? (
          <>
            <div className="row small">
              <span className="dim">{hardware?.deviceName ?? "Cube"}</span>
              <span className="grow" />
              {battery !== null ? (
                <span className={`chip${battery <= 20 ? " warn" : ""}`}>
                  {battery}% battery
                </span>
              ) : null}
            </div>
            {hardware ? (
              <div className="small faint">
                {[
                  hardware.hardwareName,
                  hardware.softwareVersion ? `firmware ${hardware.softwareVersion}` : null,
                  hardware.gyroSupported ? "gyroscope" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
            <div className="row wrap">
              <button onClick={() => void controller.syncFromCube()}>Sync state</button>
              <button
                onClick={() => void controller.markCubeSolved()}
                title="Tell the cube that it is currently solved"
              >
                Mark solved
              </button>
              <button className="ghost danger" onClick={() => void controller.disconnect()}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <button className="primary" onClick={connect} disabled={cubeStatus === "connecting"}>
              {cubeStatus === "connecting" ? "Connecting…" : "Connect a cube"}
            </button>
            <div className="small faint">
              GAN 12 ui, 12 ui FreePlay, 12 ui Maglev, 14 ui FreePlay, Mini ui FreePlay,
              356 i Carry / Carry S / Carry 2, 356 i 3, Monster Go 3Ai and MoYu AI 2023.
            </div>
          </>
        )}

        <VirtualCubeControl enabled={state.virtualCube} />
      </div>

      {macRequest ? (
        <MacDialog
          deviceName={macRequest.deviceName}
          value={macInput}
          onChange={setMacInput}
          onCancel={() => {
            macRequest.resolve(null);
            setMacRequest(null);
          }}
          onSubmit={() => {
            macRequest.resolve(macInput.trim().toUpperCase());
            setMacRequest(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Lets the whole app — scramble tracking, timing, analysis and replay — be used with
 * no hardware at all, by turning a cube on screen with the keyboard.
 */
function VirtualCubeControl({ enabled }: { enabled: boolean }) {
  const controller = useController();
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <label className="row" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => controller.setVirtualCube(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
        />
        <span className="small grow">Virtual cube (keyboard)</span>
      </label>
      {enabled ? (
        <div className="small faint" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px" }}>
          {VIRTUAL_CUBE_HELP.map((row) => (
            <span key={row.keys}>
              <b className="mono dim">{row.keys}</b> {row.move}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const MAC_PATTERN = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

/**
 * Asked for only when the browser refuses to hand over the cube's MAC address, which
 * is needed to derive the Bluetooth decryption key. Chrome on macOS and Windows needs
 * this; Android and Bluefy usually read it from the advertisement automatically.
 */
function MacDialog({
  deviceName,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  deviceName: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const valid = MAC_PATTERN.test(value.trim());
  return (
    <div className="backdrop" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Cube MAC address"
      >
        <div className="dialog-head">
          <h3>MAC address needed</h3>
        </div>
        <div className="dialog-body">
          <p className="small dim" style={{ margin: 0 }}>
            This browser will not reveal the Bluetooth address of <b>{deviceName}</b>,
            and it is needed to decrypt the cube's messages. You can read it from the
            GAN app (Cube&nbsp;→&nbsp;Information), or from a Bluetooth scanner app such
            as nRF Connect.
          </p>
          <div className="field">
            <label htmlFor="mac">MAC address</label>
            <input
              id="mac"
              autoFocus
              placeholder="AB:12:34:56:78:9A"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              spellCheck={false}
            />
            <span className="help">
              {value && !valid ? "Six pairs of hex digits, separated by colons." : " "}
            </span>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
