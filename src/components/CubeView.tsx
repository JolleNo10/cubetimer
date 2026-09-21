import { useEffect, useRef, useState } from "react";
import { TwistyPlayer } from "cubing/twisty";
import type { KPattern } from "cubing/kpuzzle";
import { solveAlg } from "../cube/solver";
import { useController } from "../hooks/useController";
import type { Settings } from "../state/types";
import {
  IDENTITY,
  conjugate,
  cubeToSceneQuaternion,
  fromEuler,
  multiply,
  normalize,
  slerp,
  type Quat,
} from "../util/quat";
import { FaceletNet } from "./FaceletNet";
import { previewFacelets } from "../cube/preview";

/** Rebuild the player's setup alg once the appended move list gets this long. */
const COMPACT_AFTER_MOVES = 400;

/** A pleasant resting angle, matching how the cube is drawn when the gyro is off. */
const HOME_ORIENTATION = fromEuler((30 * Math.PI) / 180, (-30 * Math.PI) / 180, 0);

type Props = {
  settings: Settings;
  facelets: string;
  gyroSupported: boolean;
  /** True when a real or virtual cube is feeding moves in. */
  live: boolean;
  /** Shown instead of the live state when nothing is connected. */
  scramble: string;
};

export function CubeView({ settings, facelets, gyroSupported, live, scramble }: Props) {
  const controller = useController();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const [gyroActive, setGyroActive] = useState(false);
  const resetGyroRef = useRef<() => void>(() => {});

  const use3D = settings.visualization === "3D";

  useEffect(() => {
    if (!use3D) return;
    const host = hostRef.current;
    if (!host) return;

    const player = new TwistyPlayer({
      puzzle: "3x3x3",
      visualization: "PG3D",
      background: "none",
      controlPanel: "none",
      hintFacelets: "floating",
      backView: settings.showBackView ? "top-right" : "none",
      experimentalSetupAnchor: "start",
      cameraLatitude: 27,
      cameraLongitude: -32,
      tempoScale: 5,
      alg: "",
    });
    host.appendChild(player);
    playerRef.current = player;

    let appended = 0;
    let compacting = false;

    const resync = async (pattern: KPattern) => {
      try {
        const setup = (await solveAlg(pattern)).invert();
        player.alg = "";
        player.experimentalSetupAlg = setup;
        appended = 0;
      } catch {
        // Leave the view as it is; the next reset will try again.
      }
    };

    if (!live) {
      // Nothing is connected, so show what the scramble looks like instead.
      player.experimentalSetupAlg = scramble;
      player.alg = "";
      return () => {
        player.remove();
        playerRef.current = null;
      };
    }

    const offMove = controller.onCubeMove((move) => {
      player.experimentalAddMove(move, { cancel: false });
      appended++;
      if (appended > COMPACT_AFTER_MOVES && !compacting) {
        // The alg is replayed from the start on every change, so fold it back into
        // the setup periodically to keep long sessions responsive.
        compacting = true;
        const pattern = controller.pattern;
        if (pattern) void resync(pattern).finally(() => (compacting = false));
        else compacting = false;
      }
    });
    const offReset = controller.onPatternReset((pattern) => void resync(pattern));

    const initial = controller.pattern;
    if (initial) void resync(initial);

    return () => {
      offMove();
      offReset();
      player.remove();
      playerRef.current = null;
    };
  }, [controller, use3D, settings.showBackView, live, scramble]);

  // Gyroscope: drive the 3D object directly rather than through React state, since
  // orientation updates arrive far faster than a component should re-render.
  useEffect(() => {
    const player = playerRef.current;
    if (!use3D || !player || !live || !settings.useGyroscope || !gyroSupported) {
      setGyroActive(false);
      return;
    }

    let cancelled = false;
    let basis: Quat | null = null;
    let current: Quat = HOME_ORIENTATION;
    let object: { quaternion: { set(x: number, y: number, z: number, w: number): void } } | null =
      null;
    let vantages: { scheduleRender(): void }[] = [];

    resetGyroRef.current = () => {
      basis = null;
    };

    void (async () => {
      try {
        object = (await player.experimentalCurrentThreeJSPuzzleObject()) as never;
        vantages = [...(await player.experimentalCurrentVantages())] as never;
        if (!cancelled) setGyroActive(true);
      } catch {
        // No WebGL object available (2D fallback, or the player was torn down).
      }
    })();

    const off = controller.onGyro((raw) => {
      if (cancelled || !object) return;
      const measured = cubeToSceneQuaternion(raw);
      // The first reading defines "home", so the cube appears upright wherever the
      // solver happens to be holding it when they connect.
      basis ??= conjugate(measured);
      const target = normalize(
        multiply(multiply(basis, measured), HOME_ORIENTATION),
      );
      current = slerp(current, target, 0.35);
      object.quaternion.set(current.x, current.y, current.z, current.w);
      for (const vantage of vantages) vantage.scheduleRender();
    });

    return () => {
      cancelled = true;
      off();
      setGyroActive(false);
      if (object) {
        object.quaternion.set(
          IDENTITY.x,
          IDENTITY.y,
          IDENTITY.z,
          IDENTITY.w,
        );
      }
      for (const vantage of vantages) vantage.scheduleRender();
    };
  }, [controller, use3D, live, settings.useGyroscope, gyroSupported, settings.showBackView]);

  if (settings.visualization === "off") return null;

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head">
        <span className="panel-title">{live ? "Cube" : "Scramble preview"}</span>
        <div className="row">
          {gyroActive ? (
            <button className="ghost small" onClick={() => resetGyroRef.current()}>
              Centre view
            </button>
          ) : null}
          {live ? (
            <button className="ghost small" onClick={() => void controller.syncFromCube()}>
              Sync
            </button>
          ) : null}
        </div>
      </div>
      <div className="cube-view">
        {use3D ? (
          <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
        ) : (
          <FaceletNet facelets={live ? facelets : previewFacelets(scramble)} size={22} />
        )}
      </div>
    </div>
  );
}
