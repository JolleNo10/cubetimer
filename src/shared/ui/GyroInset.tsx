import { useEffect, useRef } from "react";
import { TwistyPlayer } from "cubing/twisty";
import type { KPattern } from "cubing/kpuzzle";
import { useController } from "../../app/useController";
import { solveAlg } from "../../cube/solver";
import { normalize, relative, type Quat } from "../../util/quat";

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
    let pending: string[] | null = null;
    let appended = 0;
    let target: Quat = { x: 0, y: 0, z: 0, w: 1 };
    let object: Awaited<ReturnType<TwistyPlayer["experimentalCurrentThreeJSPuzzleObject"]>> | null = null;
    let home: Quat | null = null;
    let vantages: Awaited<ReturnType<TwistyPlayer["experimentalCurrentVantages"]>> = [];
    let frame = 0;
    const render = (immediate = false) => {
      if (!object || !home) return;
      // GAN body axes R/B/U map to Three's R/U/F: (x, z, -y).
      // The puzzle's home quaternion is presentation only, never a calibration.
      const mapped = { x: target.x, y: target.z, z: -target.y, w: target.w };
      const goal = object.quaternion.clone().set(mapped.x, mapped.y, mapped.z, mapped.w);
      goal.multiply(object.quaternion.clone().set(home.x, home.y, home.z, home.w));
      if (immediate) object.quaternion.copy(goal);
      else object.quaternion.slerp(goal, 0.35);
      for (const vantage of vantages) vantage.scheduleRender();
    };
    const animate = () => {
      if (disposed) return;
      render();
      frame = requestAnimationFrame(animate);
    };
    void Promise.all([player.experimentalCurrentThreeJSPuzzleObject(), player.experimentalCurrentVantages()])
      .then(([puzzle, views]) => {
        if (disposed) return;
        object = puzzle;
        home = { x: puzzle.quaternion.x, y: puzzle.quaternion.y, z: puzzle.quaternion.z, w: puzzle.quaternion.w };
        vantages = Array.from(views);
        render(true);
        frame = requestAnimationFrame(animate);
      }).catch(() => { /* A later mount can retry unavailable WebGL. */ });
    const resync = async (pattern: KPattern) => {
      const current = ++revision;
      pending = [];
      try {
        const setup = (await solveAlg(pattern)).invert();
        if (disposed || current !== revision) return;
        player.alg = "";
        player.experimentalSetupAlg = setup;
        appended = 0;
        for (const move of pending ?? []) player.experimentalAddMove(move, { cancel: false });
      } finally {
        if (current === revision) pending = null;
      }
    };
    const sync = (pattern: KPattern) => { void resync(pattern).catch(() => {}); };
    const offMove = controller.onCubeMove(move => {
      if (pending) pending.push(move);
      else player.experimentalAddMove(move, { cancel: false });
      if (++appended > 400 && !pending && controller.pattern) sync(controller.pattern);
    });
    const offPattern = controller.onPatternReset(sync);
    const offGyro = controller.onGyro(q => {
      const reference = controller.gripReference;
      if (reference) target = normalize(relative(reference, q));
    });
    const offReference = controller.onRecentreView(() => {
      target = { x: 0, y: 0, z: 0, w: 1 };
      render(true);
    });
    if (controller.pattern) sync(controller.pattern);
    return () => {
      disposed = true;
      revision++;
      cancelAnimationFrame(frame);
      offMove(); offPattern(); offGyro(); offReference();
      player.remove();
    };
  }, [controller]);
  return <div ref={hostRef} className="gyro-inset" aria-label="Live gyro cube" />;
}
