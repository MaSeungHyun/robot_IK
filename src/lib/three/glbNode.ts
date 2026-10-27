import { PropertyBinding, type Object3D } from "three";

/**
 * A node by its glTF name. GLTFLoader sanitizes object names ("rail.001" -> "rail001") and keeps the
 * authored name in userData.name, so a plain getObjectByName("rail.001") misses.
 */
export function findGlbNode(root: Object3D, name: string, rootChildrenOnly = false): Object3D | undefined {
  const clean = PropertyBinding.sanitizeNodeName(name);
  const hit = (o: Object3D) => o.userData.name === name || o.name === name || o.name === clean;
  if (rootChildrenOnly) return root.children.find(hit);
  let found: Object3D | undefined;
  root.traverse((o) => { if (!found && hit(o)) found = o; });
  return found;
}

/** Removes KHR_lights_punctual lights from a cloned subtree (template lights are owned by viewport/lighting). */
export function stripLights(root: Object3D) {
  const lights: Object3D[] = [];
  root.traverse((o) => { if ((o as Object3D & { isLight?: boolean }).isLight) lights.push(o); });
  lights.forEach((o) => o.removeFromParent());
  return root;
}
