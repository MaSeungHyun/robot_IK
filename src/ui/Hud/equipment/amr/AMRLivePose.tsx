import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { SceneObjectResolver, worldYaw } from "@/viewport/scene/sceneObjects";

/** Readout refresh rate: ~10 Hz, written straight into the text node (no React state). */
const INTERVAL_MS = 100;

type Props = { id: string; field: "position" | "heading" };

/** Live AMR position (x, z m) or heading (deg, 0 = +Z, clockwise seen from above is negative). */
export default function AMRLivePose({ id, field }: Props) {
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const resolver = new SceneObjectResolver(), position = new Vector3();
    const update = () => {
      const node = text.current;
      if (!node) return;
      const object = resolver.resolve(id);
      let value = "—";
      if (object) {
        if (field === "position") {
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
