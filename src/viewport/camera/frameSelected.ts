import { Box3, Sphere, Vector3, type Object3D } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { useCargoStore } from "@/stores/useCargoStore";
import { editableGroups } from "@/viewport/editor/editableRegistry";
import { SceneObjectResolver } from "@/viewport/scene/sceneObjects";

/** Radius used when the object has no measurable geometry (e.g. drawn only through instancing). */
const FALLBACK_RADIUS = 1;
const resolver = new SceneObjectResolver();
const box = new Box3();

/** Selected equipment (edit or run) or cargo box id, else null. */
export function selectedFocusId() {
  return useSceneStore.getState().selected ?? useCargoStore.getState().selectedBoxId;
}

function resolve(id: string): Object3D | null {
  if (useSceneStore.getState().editing) {
    const group = editableGroups.get(id);
    if (group) return group;
  }
  return resolver.resolve(id);
}

/** World bounding sphere of the object with scene id / box id `id`, at this moment. */
export function focusSphere(id: string): Sphere | null {
  const object = resolve(id);
  if (!object) return null;
  object.updateWorldMatrix(true, true);
  box.setFromObject(object, true);
  const sphere = new Sphere();
  if (box.isEmpty()) {
    sphere.set(object.getWorldPosition(new Vector3()), FALLBACK_RADIUS);
    sphere.center.y += FALLBACK_RADIUS / 2;
  } else box.getBoundingSphere(sphere);
  sphere.radius = Math.max(sphere.radius, 0.25);
  return sphere;
}