import type { Object3D } from "three";

/** Rendering integration required by the runtime; no dependency on a viewport implementation. */
export interface SimulationRenderer {
  register: (object: Object3D) => (() => void);
  /** `deep`: drop the object and its nested cargo regardless of remaining references (simulation stop). */
  unregister: (object: Object3D, deep?: boolean) => void;
  /** Unregisters cargo that left its owner and is no longer drawn by any scene node (simulation stop). */
  releaseOrphans?: () => void;
}
