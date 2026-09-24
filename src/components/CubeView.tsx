import { useEffect, useMemo, useRef, useState } from "react";
import { Alg } from "cubing/alg";
import { TwistyPlayer } from "cubing/twisty";
import type { KPattern } from "cubing/kpuzzle";
import { faceOfColour } from "../cube/colours";
import {
  IDENTITY,
  reorientMove,
  rotationForCrossFace,
  rotationForGrip,
  rotationTokensBetween,
  type Orientation,
} from "../cube/orientation";
import { solveAlg } from "../cube/solver";
import { useController } from "../hooks/useController";
import type { Settings } from "../state/types";
import { FaceletNet } from "./FaceletNet";
import { previewFacelets } from "../cube/preview";

/** Rebuild the player's setup alg once the appended move list gets this long. */
const COMPACT_AFTER_MOVES = 400;

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
  const [flash, setFlash] = useState(false);
  const resetGyroRef = useRef<() => void>(() => {});

  const use3D = settings.visualization === "3D";

  // A solver applies the scramble white on top, then turns the cube over to build the
  // cross. Showing the live cube the same way up means the screen matches their hands.
  //
  // With a gyroscope the grip is measured rather than declared, and the settings step
  // aside — but only as the starting point. The cube is drawn square on and stays that
  // way; when the solver turns it, the view turns with them by the same whole-cube
  // rotation, rather than tumbling about after the raw readings.
  const gyroDriven = settings.useGyroscope && gyroSupported;
  const solveOrientation = useMemo(() => {
    if (!live || gyroDriven) return null;
    const bottom = faceOfColour(settings.crossColour);
    if (!bottom) return null;
    const front = faceOfColour(settings.frontColour);
    // Both chosen faces if they can both be had; otherwise just the bottom one.
    return (
      (front && rotationForGrip(bottom, front)) ?? rotationForCrossFace(bottom)
    );
  }, [live, gyroDriven, settings.crossColour, settings.frontColour]);

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
    // How the cube is being held. Measured when there is a gyroscope to measure it
    // with, and otherwise whatever the solver said in the settings.
    //
    // With a gyroscope the starting point is the cube as scrambled — white on top,
    // green in front — because that is how it is being held while the scramble goes
    // on. The solver turns it over during inspection and the view follows them. The
    // cross colour from the settings is no help here and would have the cube upside
    // down for the whole scramble.
    let held: Orientation | null = gyroDriven
      ? (controller.heldAs ?? IDENTITY)
      : (solveOrientation?.orientation ?? null);

    const resync = async (pattern: KPattern) => {
      try {
        const setup = (await solveAlg(pattern)).invert();
        player.alg = "";
        // Turn the cube over after building the state, so the cross colour ends up
        // underneath. The moves fed in afterwards are relabelled to match, which is
        // what keeps `U` turning the face that is now on top.
        const tokens = held ? rotationTokensBetween(IDENTITY, held) : [];
        player.experimentalSetupAlg = tokens.length
          ? setup.concat(new Alg(tokens.join(" ")))
          : setup;
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

    // Turning the real cube over turns the drawn one over the same way, so the two
    // stay in step and the moves fed in afterwards go on meaning what they say.
    const offGrip = gyroDriven
      ? controller.onGripChange((orientation) => {
          if (held) {
            for (const token of rotationTokensBetween(held, orientation)) {
              player.experimentalAddMove(token, { cancel: false });
              appended++;
            }
          }
          held = orientation;
        })
      : () => {};

    const offMove = controller.onCubeMove((move) => {
      player.experimentalAddMove(held ? reorientMove(move, held) : move, {
        cancel: false,
      });
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
      offGrip();
      offMove();
      offReset();
      player.remove();
      playerRef.current = null;
    };
  }, [
    controller,
    use3D,
    settings.showBackView,
    live,
    scramble,
    solveOrientation,
    gyroDriven,
  ]);

  // The gyroscope no longer turns the drawn cube directly — the grip it settles into
  // does, through the rotations added above. All that is left here is knowing whether
  // there is a grip being followed at all, which is what the centring button acts on.
  useEffect(() => {
    if (!use3D || !live || !gyroDriven) {
      setGyroActive(false);
      return;
    }
    resetGyroRef.current = () => controller.recentreGrip();
    setGyroActive(true);
    return () => setGyroActive(false);
  }, [controller, use3D, live, gyroDriven]);

  // Turning U three times lines the view up with however the cube is being held, so
  // the solver never has to put it down to reach the button.
  useEffect(() => {
    return controller.onRecentreView(() => {
      resetGyroRef.current();
      setFlash(true);
      setTimeout(() => setFlash(false), 1400);
    });
  }, [controller]);

  if (settings.visualization === "off") return null;

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head">
        <span className="panel-title">{live ? "Cube" : "Scramble preview"}</span>
        <div className="row">
          {gyroActive ? (
            <button
              className="ghost small"
              onClick={() => resetGyroRef.current()}
              title="Or turn the top face three times on the cube"
            >
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
        {flash ? (
          <div className="cube-flash" role="status">
            {gyroActive
              ? "View centred"
              : "Nothing to centre — this cube has no gyroscope"}
          </div>
        ) : null}
        {use3D ? (
          <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
        ) : (
          <FaceletNet facelets={live ? facelets : previewFacelets(scramble)} size={22} />
        )}
      </div>
    </div>
  );
}
