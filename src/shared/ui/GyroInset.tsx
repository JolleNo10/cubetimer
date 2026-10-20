import { useEffect, useRef } from "react";
import { TwistyPlayer } from "cubing/twisty";
import type { KPattern } from "cubing/kpuzzle";
import { useController } from "../../app/useController";
import { solveAlg } from "../../cube/solver";
import { normalize, relative, type Quat } from "../../util/quat";

type PuzzleObject = Awaited<ReturnType<TwistyPlayer["experimentalCurrentThreeJSPuzzleObject"]>>;

/** Timer-only presentation: calibration always comes from LiveGrip via Controller. */
export function GyroInset() {
  const controller = useController();
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const player = new TwistyPlayer({
      puzzle: "3x3x3", visualization: "PG3D", background: "none",
      controlPanel: "none", backView: "none", hintFacelets: "none",
      experimentalDragInput: "none", experimentalSetupAnchor: "start",
      cameraLatitude: 27, cameraLongitude: 32, tempoScale: 5, alg: "",
    });
    hostRef.current?.appendChild(player);
    let disposed = false;
    let revision = 0;
    let bindingRevision = 0;
    let pending: string[] | null = null;
    let appended = 0;
    let target: Quat = { x: 0, y: 0, z: 0, w: 1 };
    let object: PuzzleObject | null = null;
    // One presentation home for this player, not a calibration reference. A rebound
    // object may already carry our gyro rotation, so never sample its home again.
    let home: Quat | null = null;
    let vantages: Awaited<ReturnType<TwistyPlayer["experimentalCurrentVantages"]>> = [];
    const render = (immediate = false) => {
      if (!object || !home) return;
      // GAN body axes R/B/U map to Three's R/U/F: (x, z, -y).
      const mapped = { x: target.x, y: target.z, z: -target.y, w: target.w };
      const goal = object.quaternion.clone().set(mapped.x, mapped.y, mapped.z, mapped.w);
      goal.multiply(object.quaternion.clone().set(home.x, home.y, home.z, home.w));
      if (immediate) object.quaternion.copy(goal);
      else object.quaternion.slerp(goal, 0.35);
      for (const vantage of vantages) vantage.scheduleRender();
    };
    const bindRenderTarget = async () => {
      const binding = ++bindingRevision;
      object = null;
      const puzzle = await player.experimentalCurrentThreeJSPuzzleObject();
      if (disposed || binding !== bindingRevision) return;
      // The scene's vantages can be empty until its puzzle initializes, especially
      // when this player remounts after a solve. Acquire them in that order.
      const views = await player.experimentalCurrentVantages();
      if (disposed || binding !== bindingRevision) return;
      if (!home) {
        const { x, y, z, w } = puzzle.quaternion;
        home = { x, y, z, w };
      }
      object = puzzle;
      vantages = Array.from(views);
      render(true);
    };
    const resync = async (pattern: KPattern) => {
      const current = ++revision;
      const moves: string[] = [];
      pending = moves;
      try {
        const setup = (await solveAlg(pattern)).invert();
        if (disposed || current !== revision) return;
        player.alg = "";
        player.experimentalSetupAlg = setup;
        for (const move of moves) player.experimentalAddMove(move, { cancel: false });
        appended = moves.length;
        pending = null;
        // Acquire only after setup replacement. Binding has its own generation:
        // a newer calculation may fail while this committed setup stays current.
        await bindRenderTarget();
      } catch {
        // Moves already reached the visible player. Initial setup failure can still
        // bind the default render target; later failures keep the current target.
        if (!disposed && current === revision && !object) await bindRenderTarget();
      } finally {
        if (current === revision) pending = null;
      }
    };
    const sync = (pattern: KPattern) => { void resync(pattern).catch(() => {}); };
    const offMove = controller.onCubeMove(move => {
      player.experimentalAddMove(move, { cancel: false });
      pending?.push(move);
      if (++appended > 400 && !pending && controller.pattern) sync(controller.pattern);
    });
    const offPattern = controller.onPatternReset(sync);
    // Samples arriving during setup only update the latest presentation target.
    // Once bound, each raw event itself updates the object and requests rendering.
    const offGyro = controller.onGyro(q => {
      const reference = controller.gripReference;
      if (reference) { target = normalize(relative(reference, q)); render(); }
    });
    const offReference = controller.onGyroReferenceChange(() => {
      target = { x: 0, y: 0, z: 0, w: 1 };
      render(true);
    });
    if (controller.pattern) sync(controller.pattern);
    else void bindRenderTarget().catch(() => {});
    return () => {
      disposed = true;
      revision++;
      bindingRevision++;
      offMove(); offPattern(); offGyro(); offReference();
      player.remove();
    };
  }, [controller]);
  return <div ref={hostRef} className="gyro-inset" aria-label="Live gyro cube" />;
}
