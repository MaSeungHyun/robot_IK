import type { Object3D } from "three";

/**
 * Scene id of the equipment that owns `node`, walking up the parents. Cargo (boxes) is tagged
 * with `userData.cargo` and belongs to no equipment, even while it sits on a belt or pallet or
 * hangs from a robot, so selecting/outlining/tracking a conveyor or pallet never includes it.
 */
export function sceneOwner(node: Object3D | null): string | null {
  for (; node; node = node.parent) {
    if (node.userData.cargo) return null;
    if (node.userData.sceneId) return node.userData.sceneId as string;
  }
  return null;
}
/** Box id (B-0001...) when `node` is part of a cargo box, else null. */
export function cargoBoxId(node: Object3D | null): string | null {
  for (; node; node = node.parent) if (node.userData.cargo) return (node.userData.boxId as string | undefined) ?? null;
  return null;
}
