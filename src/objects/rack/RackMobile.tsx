import { useMemo } from "react";
import { createAgvModel, createRackMobileModel } from "@/lib/three/cycleModels";

/** Rack_m (mobile rack) model: a separate object from Rack.glb, never instanced together with it. */
export function RackMobile() {
  const model = useMemo(() => createRackMobileModel(), []);
  return <primitive object={model} userData={{ excludeFromInstancing: true }} />;
}

/** Lifting AGV body (procedural, same model as the simulation). */
export function AgvBody() {
  const model = useMemo(() => createAgvModel().root, []);
  return <primitive object={model} />;
}
