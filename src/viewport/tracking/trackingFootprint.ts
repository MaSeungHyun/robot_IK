import { Mesh } from "three";
import { Matrix4 } from "three";
import type { Box3, Object3D } from "three";

const toSpace = new Matrix4();

/** Skip importer wrappers, then measure only the first child model, not its siblings. */
/** `space` (e.g. the inverse of root.matrixWorld) measures in that frame instead of world space. */
export function trackingFootprint(root: Object3D, bounds: Box3, part: Box3, space?: Matrix4) {
  // A root can name its model explicitly (e.g. the forklift carrier also holds the fork group and route line).
  const marked = root.children.find((child) => child.userData.trackingModel);
  let model = marked ?? root;
  while (!(model instanceof Mesh) && model.children.length === 1) model = model.children[0];
  const firstChild = model instanceof Mesh ? model : model.children[0];
  bounds.makeEmpty();
  if (!firstChild) return bounds;
  firstChild.updateWorldMatrix(true, true);
  // Source meshes remain measurable even when the instancing renderer hides them.
  firstChild.traverse((node) => {
    if (!(node instanceof Mesh) || node.userData.trackingDecoration) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox) bounds.union(part.copy(node.geometry.boundingBox).applyMatrix4(space ? toSpace.multiplyMatrices(space, node.matrixWorld) : node.matrixWorld));
  });
  return bounds;
}
