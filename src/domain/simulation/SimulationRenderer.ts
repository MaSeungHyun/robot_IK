import type { Object3D } from "three";

/** Rendering integration required by the runtime; no dependency on a viewport implementation. */
export interface SimulationRenderer {
  register: (object: Object3D) => (() => void);
  unregister: (object: Object3D) => void;
}
