import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import { minimapCamera, minimapCommands } from "@/viewport/minimap/minimapBridge";

type Controls = { target: Vector3; update: () => void } | null;

/** In-Canvas: samples camera pose at ~8 Hz for the minimap and exposes "look at" for clicks. */
export default function MinimapProbe() {
  const enabled = useViewportSettingsStore((state) => state.minimap);
  const get = useThree((state) => state.get);
  const last = useRef(0);
  const direction = useRef(new Vector3());

  useEffect(() => {
    if (!enabled) return;
    minimapCommands.lookAt = (x, z) => {
      const { camera, controls } = get();
      const orbit = controls as unknown as Controls;
      if (!orbit) return;
      const dx = x - orbit.target.x, dz = z - orbit.target.z;
      orbit.target.x += dx;
      orbit.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
      orbit.update();
    };
    return () => {
      minimapCommands.lookAt = null;
      minimapCamera.ready = false;
    };
  }, [enabled, get]);

  useFrame(({ camera, controls, clock }) => {
    if (!enabled || clock.elapsedTime - last.current < 0.125) return;
    last.current = clock.elapsedTime;
    camera.getWorldDirection(direction.current);
    const orbit = controls as unknown as Controls;
    minimapCamera.x = camera.position.x;
    minimapCamera.z = camera.position.z;
    // Looking straight down has no horizontal direction: keep the previous heading.
    if (Math.hypot(direction.current.x, direction.current.z) > 1e-3)
      minimapCamera.yaw = Math.atan2(direction.current.x, direction.current.z);
    minimapCamera.targetX = orbit?.target.x ?? camera.position.x;
    minimapCamera.targetZ = orbit?.target.z ?? camera.position.z;
    minimapCamera.ready = true;
  });
  return null;
}
