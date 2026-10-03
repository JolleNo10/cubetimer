import { useController, useSettings, useStoreValue } from "../../../app/useController";
import { CubeView } from "../../../shared/ui/CubeView";

/** Physical rendering subscribes here; the 3D view retains its direct event path. */
export function TimerCubeStage() {
  const controller = useController();
  const settings = useSettings();
  const facelets = useStoreValue(controller.physical.state, state => state.cubeFacelets);
  const gyroSupported = useStoreValue(controller.physical.state, state => state.hardware?.gyroSupported ?? false);
  const live = useStoreValue(controller.physical.state, state => state.cubeStatus === "connected" || state.virtualCube);
  const scramble = useStoreValue(controller.timer.state, state => state.scramble);
  return <CubeView settings={settings} facelets={facelets} gyroSupported={gyroSupported} live={live} scramble={scramble} />;
}
