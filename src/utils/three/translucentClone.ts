import { Mesh } from "three";
import type { Group, Material } from "three";

export function translucentClone(source: Group) {
  const model = source.clone(true),
    materials: Material[] = [];
  model.traverse((node) => {
    if (node instanceof Mesh) {
      const ghost = (material: Material) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = 0.35;
        copy.depthWrite = false;
        materials.push(copy);
        return copy;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(ghost)
        : ghost(node.material);
      node.visible = true;
      node.raycast = () => { };
      node.castShadow = false;
    }
  });
  return {
    model,
    dispose: () => materials.forEach((material) => material.dispose()),
  };
}
