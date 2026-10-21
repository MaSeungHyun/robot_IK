import type { Object3D } from "three";

/**
 * Live runtime objects by scene id, shared by the camera tracker and HUD readouts. Runtime
 * objects (robot rigs, AMR carriers, pallets, static groups, instance owners) carry
 * userData.sceneId; their transforms are live even when drawn through instancing.
 */
let sceneRoot: Object3D | null = null;

export function setSceneRoot(root: Object3D | null) {
  sceneRoot = root;
}

function attached(object: Object3D, root: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

/** How often a missing object is searched for again (the search walks the scene graph). */
const RETRY_MS = 250;

/** Caches the object for one id; re-resolves only when it left the scene. */
export class SceneObjectResolver {
  private id: string | null = null;
  private object: Object3D | null = null;
  private retryAt = 0;

  resolve(id: string | null): Object3D | null {
    const root = sceneRoot;
    if (!id || !root) return null;
    if (id !== this.id) { this.id = id; this.object = null; this.retryAt = 0; }
    if (this.object && attached(this.object, root)) return this.object;
    this.object = null;
    const now = performance.now();
    if (now < this.retryAt) return null;
    this.retryAt = now + RETRY_MS;
    let found: Object3D | null = null;
    root.traverse((node) => { if (!found && node.userData.sceneId === id) found = node; });
    this.object = found;
    return found;
  }
}

/** World heading around +Y in radians; 0 = facing +Z (AMR travel direction is atan2(dx, dz)). */
export function worldYaw(object: Object3D) {
  const e = object.matrixWorld.elements;
  return Math.atan2(e[8], e[10]);
}
