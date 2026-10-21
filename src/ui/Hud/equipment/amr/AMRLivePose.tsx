import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { SceneObjectResolver, worldYaw } from "@/viewport/scene/sceneObjects";
import { smoothingAlpha } from "@/lib/interpolation";
import { useSimulationStore } from "@/stores/useSimulationStore";

/** Time constant (wall ms) for the measured-speed readout. */
const SPEED_TAU_MS = 300;

/** Readout refresh rate: ~10 Hz, written straight into the text node (no React state). */
const INTERVAL_MS = 100;

type Props = { id: string; field: "position" | "heading" | "speed" };

/** Live AMR position (x, z m), speed (m/s in simulation time, measured from the moving model) or heading (deg, 0 = +Z, clockwise seen from above is negative). */
export default function AMRLivePose({ id, field }: Props) {
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const resolver = new SceneObjectResolver(), position = new Vector3(), last = new Vector3();
    let lastAt = 0, speed = 0;
    const update = () => {
      const node = text.current;
      if (!node) return;
      const object = resolver.resolve(id);
      let value = "—";
      if (object) {
        if (field === "speed") {
          object.getWorldPosition(position);
          const now = performance.now();
          const wall = now - lastAt;
          const simSeconds = (wall / 1000) * useSimulationStore.getState().speed;
          if (lastAt && simSeconds > 0) {
            const measured = Math.hypot(position.x - last.x, position.z - last.z) / simSeconds;
            speed += (measured - speed) * smoothingAlpha(wall, SPEED_TAU_MS);
          }
          last.copy(position);
          lastAt = now;
          value = `${speed.toFixed(1)} m/s`;
        } else if (field === "position") {
          object.getWorldPosition(position);
          value = `x ${position.x.toFixed(2)} m · z ${position.z.toFixed(2)} m`;
        } else {
          const degrees = ((worldYaw(object) * 180) / Math.PI + 360) % 360;
          value = `${degrees.toFixed(0)}°`;
        }
      }
      if (node.textContent !== value) node.textContent = value;
    };
    update();
    const timer = window.setInterval(update, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [id, field]);
  return <span ref={text} className="tabular-nums">—</span>;
}
