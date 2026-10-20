import { useEffect, useMemo, useRef, useState } from "react";
import { Alg } from "cubing/alg";
import { TwistyPlayer } from "cubing/twisty";
import type { KPattern } from "cubing/kpuzzle";
import { faceOfColour } from "../../cube/colours";
import {
  IDENTITY,
  compose,
  invert,
  reorientMove,
  rotationForCrossFace,
  rotationForGrip,
  rotationTokensBetween,
  type Orientation,
} from "../../cube/orientation";
import { snapOrientation } from "../../cube/gyroGrip";
import { solveAlg } from "../../cube/solver";
import { trainingFocusMask, trainingFocusFacelets, type TrainingFocusTarget } from "../../cube/trainingFocus";
import { GyroInset } from "./GyroInset";
import { useController } from "../../app/useController";
import type { Settings } from "../../app/types";
import { FaceletNet } from "./FaceletNet";
import { faceletsToPattern } from "../../cube/facelets";
import { previewFacelets } from "../../cube/preview";
import { reorientMoveGuide, type MoveGuide } from "../../cube/moveGuide";
import { CubeMoveGuide } from "./CubeMoveGuide";
import { orientFaceletsForDisplay } from "../../cube/frames";

/** Rebuild the player's setup alg once the appended move list gets this long. */
const COMPACT_AFTER_MOVES = 400;

type Props = {
  followTrainingGrip?: boolean;
  trainingFocus?: TrainingFocusTarget;
  showGyroInset?: boolean;
  gyroResetDisabled?: boolean;
  settings: Settings;
  facelets: string;
  gyroSupported: boolean;
  /** True when a real or virtual cube is feeding moves in. */
  live: boolean;
  /** Shown instead of the live state when nothing is connected. */
  scramble: string;
  /** Optional alternate pattern for F2L virtual practice or a target preview. */
  displayFacelets?: string;
  /** Opaque reset key; changing it reloads the alternate pattern in 3D. */
  displayRevision?: string | number;
  /** Show a hypothetical pattern without appending live moves or pattern resets. */
  staticDisplay?: boolean;
  /** Identifies whether incoming move/reset events belong to the displayed pattern. */
  displaySource?: "physical" | "virtual";
  /** Whether a Sync action can read a physical cube; defaults to the live source. */
  physicalSyncAvailable?: boolean;
  /** Explicit grip for training views; it overrides settings and gyro orientation. */
  orientationOverride?: Orientation;
  /** Presentation only; the caller owns instructional progress and visibility. */
  guideMove?: MoveGuide | null;
};

export function CubeView({
  settings,
  trainingFocus,
  followTrainingGrip = false,
  showGyroInset = false,
  gyroResetDisabled = false,
  facelets,
  gyroSupported,
  live,
  scramble,
  displayFacelets,
  displayRevision = 0,
  staticDisplay = false,
  displaySource = "physical",
  physicalSyncAvailable,
  orientationOverride,
  guideMove,
}: Props) {
  const controller = useController();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const gyroActive = showGyroInset && live && gyroSupported && !staticDisplay && displaySource === "physical";
  const [gyroReady, setGyroReady] = useState(Boolean(controller.gripReference));
  const [flash, setFlash] = useState("");
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showFeedback(message: string) {
    clearTimeout(flashTimeout.current);
    setFlash(message);
    flashTimeout.current = setTimeout(() => setFlash(""), 1400);
  }
  useEffect(() => () => clearTimeout(flashTimeout.current), []);

  const use3D = settings.visualization === "3D";
  const trainingGyro = followTrainingGrip && settings.useGyroscope && gyroSupported && !staticDisplay;
  const guiding = use3D && Boolean(guideMove);
  const [trainingHeld, setTrainingHeld] = useState<Orientation | null>(null);

  // A solver applies the scramble white on top, then turns the cube over to build the
  // cross. Showing the live cube the same way up means the screen matches their hands.
  //
  // With a gyroscope the grip is measured rather than declared, and the settings step
  // aside — but only as the starting point. The cube is drawn square on and stays that
  // way; when the solver turns it, the view turns with them by the same whole-cube
  // rotation, rather than tumbling about after the raw readings.
  const gyroDriven = !orientationOverride && settings.useGyroscope && gyroSupported;
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
  const heldOverride = orientationOverride ?? solveOrientation?.orientation ?? null;
  const displayFaceletsRef = useRef(displayFacelets);
  displayFaceletsRef.current = displayFacelets;
  const orientedDisplayFacelets = useMemo(() => {
    if (!displayFacelets || !orientationOverride || !controller.pattern) {
      return displayFacelets;
    }
    return orientFaceletsForDisplay(
      controller.pattern.kpuzzle,
      displayFacelets,
      orientationOverride,
    );
  }, [controller, displayFacelets, orientationOverride]);

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
      experimentalStickeringMaskOrbits: trainingFocus ? trainingFocusMask(trainingFocus) : undefined,
      backView: "none",
      experimentalSetupAnchor: "start",
      cameraLatitude: 27,
      cameraLongitude: 32,
      experimentalDragInput: guiding ? "none" : "auto",
      tempoScale: 5,
      alg: "",
    });
    host.appendChild(player);
    playerRef.current = player;

    setTrainingHeld(null);
    let disposed = false;
    let revision = 0;
    let pendingMoves: string[] | null = null;
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
      : heldOverride;

    const displayedPattern = (): KPattern | null => {
      const physical = controller.pattern;
      const shown = displayFaceletsRef.current;
      if (!physical) return null;
      if (shown) return faceletsToPattern(physical.kpuzzle, shown);
      return live || displaySource === "virtual" ? physical : null;
    };

    const resync = async (pattern: KPattern) => {
      const current = ++revision;
      pendingMoves = [];
      const orientation = held;
      try {
        const setup = (await solveAlg(pattern)).invert();
        if (disposed || current !== revision) return;
        player.alg = "";
        // Turn the cube over after building the state, so the cross colour ends up
        // underneath. The moves fed in afterwards are relabelled to match, which is
        // what keeps `U` turning the face that is now on top.
        const tokens = orientation ? rotationTokensBetween(IDENTITY, orientation) : [];
        player.experimentalSetupAlg = tokens.length
          ? setup.concat(new Alg(tokens.join(" ")))
          : setup;
        appended = pendingMoves?.length ?? 0;
        for (const move of pendingMoves ?? []) player.experimentalAddMove(move, { cancel: false });
      } catch {
        // Leave the view as it is; the next reset will try again.
      } finally {
        if (current === revision) pendingMoves = null;
      }
    };

    if (!live || staticDisplay) {
      // A training target can still be previewed without a connected cube.
      const initial = displayedPattern();
      if (initial) void resync(initial);
      else {
        player.experimentalSetupAlg = scramble;
        player.alg = "";
      }
      return () => {
        disposed = true;
        player.remove();
        playerRef.current = null;
      };
    }

    const append = (token: string) => {
      player.experimentalAddMove(token, { cancel: false });
      pendingMoves?.push(token);
      appended++;
    };

    // Turning the real cube over turns the drawn one over the same way, so the two
    // stay in step and the moves fed in afterwards go on meaning what they say.
    const offGrip = gyroDriven
      ? controller.onGripChange((orientation) => {
          if (held) {
            for (const token of rotationTokensBetween(held, orientation)) {
              append(token);
            }
          }
          held = orientation;
        })
      : () => {};

    // F2L view-only grip tracking also works while the shared reference is unlocked.
    // It uses the authoritative reference directly, without recalibrating Training.
    let candidate: Orientation | null = null;
    let candidateSince = 0;
    const offTrainingGyro = trainingGyro ? controller.onGyro(q => {
      const reference = controller.gripReference;
      if (!reference) return;
      const snapped = snapOrientation(q, reference);
      if (snapped.margin < 0.1) { candidate = null; return; }
      const next = snapped.orientation;
      const key = (value: Orientation | null) => value && Object.values(value).join("");
      if (key(next) === key(held)) { candidate = null; return; }
      if (key(next) !== key(candidate)) { candidate = next; candidateSince = performance.now(); return; }
      if (performance.now() - candidateSince < 120) return;
      for (const token of rotationTokensBetween(held ?? IDENTITY, next)) append(token);
      held = next;
      setTrainingHeld(next);
      candidate = null;
    }) : () => {};

    const offMove = controller.onCubeMove((move) => {
      const token = held ? reorientMove(move, held) : move;
      append(token);
      if (appended > COMPACT_AFTER_MOVES && !compacting && !pendingMoves) {
        // The alg is replayed from the start on every change, so fold it back into
        // the setup periodically to keep long sessions responsive.
        compacting = true;
        const pattern = displayedPattern();
        if (pattern) void resync(pattern).finally(() => (compacting = false));
        else compacting = false;
      }
    });
    const offReset =
      displaySource === "virtual"
        ? () => {}
        : controller.onPatternReset((pattern) => void resync(pattern));

    const offReference = controller.onGyroReferenceChange(() => {
      candidate = null;
      setTrainingHeld(trainingGyro ? IDENTITY : null);
      if ((gyroDriven || trainingGyro) && held) {
        for (const token of rotationTokensBetween(held, IDENTITY)) append(token);
      }
      held = gyroDriven || trainingGyro ? IDENTITY : heldOverride;
      const pattern = displayedPattern();
      if (pattern) void resync(pattern);
    });
    const initial = displayedPattern();
    if (initial) void resync(initial);

    return () => {
      disposed = true;
      offReference();
      offGrip();
      offTrainingGyro();
      offMove();
      offReset();
      player.remove();
      playerRef.current = null;
    };
  }, [
    controller,
    use3D,
    live,
    scramble,
    solveOrientation,
    gyroDriven,
    heldOverride,
    displayRevision,
    displaySource,
    guiding,
    staticDisplay,
    trainingFocus,
    trainingGyro,
  ]);

  useEffect(() => {
    let ready = Boolean(controller.gripReference) && gyroActive;
    setGyroReady(ready);
    if (!gyroActive) return;
    return controller.onGyro(() => {
      if (!ready && controller.gripReference) { ready = true; setGyroReady(true); }
    });
  }, [controller, gyroActive]);

  useEffect(() => {
    if (!showGyroInset) return;
    return controller.onGyroReferenceChange(reason => {
      if (reason === "reset") showFeedback("Gyro orientation reset");
    });
  }, [controller, showGyroInset]);

  if (settings.visualization === "off") return null;

  const displayedGuide = guideMove && trainingGyro && trainingHeld
    ? reorientMoveGuide(guideMove, compose(invert(heldOverride ?? IDENTITY), trainingHeld)) : guideMove;
  const focusMask = trainingFocus ? trainingFocusMask(trainingFocus) : undefined;
  const sourcePattern = focusMask && displayFacelets && controller.pattern ? faceletsToPattern(controller.pattern.kpuzzle, displayFacelets) : null;
  let visibleStickers = focusMask && sourcePattern ? trainingFocusFacelets(sourcePattern, focusMask) : undefined;
  if (visibleStickers && orientationOverride && controller.pattern) {
    const tokens = rotationTokensBetween(IDENTITY, orientationOverride);
    visibleStickers = trainingFocusFacelets(sourcePattern!.applyAlg(new Alg(tokens.join(" "))), focusMask!);
  }
  const shownFacelets =
    orientedDisplayFacelets || (live ? facelets : previewFacelets(scramble));

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head">
        <span className="panel-title">{live ? "Cube" : "Scramble preview"}</span>
        <div className="row">
          {gyroActive && gyroReady ? (
            <button
              className="ghost small"
              disabled={gyroResetDisabled}
              onClick={() => { if (!controller.resetGyro()) showFeedback("Gyro reset unavailable"); }}
              title="Treat the cube's current position as level, with white on top and green in front. Shortcut: U×4 or U'×4 while scrambling, before turns start timing."
            >
              Reset gyro
            </button>
          ) : null}
          {(physicalSyncAvailable ?? live) ? (
            <button className="ghost small" onClick={() => void controller.syncFromCube()}>
              Sync
            </button>
          ) : null}
        </div>
      </div>
      <div className="cube-view">
        {flash ? (
          <div className="cube-flash" role="status">
            {flash}
          </div>
        ) : null}
        {use3D ? (
          <div ref={hostRef} className={guiding ? "cube-player-host guided" : "cube-player-host"} style={{ width: "100%", height: "100%" }} />
        ) : (
          <FaceletNet facelets={shownFacelets} visibleStickers={visibleStickers} size={22} />
        )}
        {use3D && gyroActive && settings.showGyroView && !displayFacelets && !orientationOverride ? <GyroInset /> : null}
        {use3D && displayedGuide ? <CubeMoveGuide move={displayedGuide} /> : null}
      </div>
    </div>
  );
}
