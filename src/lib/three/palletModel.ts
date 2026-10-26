import { Group, Mesh } from "three";
import { createLowPolyPallet } from "@/lib/three/lowPolyPallet";
import { createUnitPallet } from "@/lib/three/modelNormalization";

/** Vertex count above which a pallet mesh gets the low-poly LOD stand-in (the real-size pallet.glb has 244). */
const LOW_POLY_MIN_VERTICES = 2000;

const templates = new WeakMap<Group, Group>();

/** Pallet-owned dimensions and shared geometry for preview and simulation. */
export function createPalletModel(asset: Group) {
  let template = templates.get(asset);
  if (!template) {
    template = createUnitPallet(asset);
    // Static (racked) pallets render with a low-poly stand-in only for heavy meshes; see SceneInstances LOD.
    // The deck + runners box is the old pallet's silhouette, so a light pallet.glb keeps its own mesh.
    template.traverse((node) => {
      if (node instanceof Mesh && !node.geometry.userData.lowPoly && (node.geometry.attributes.position?.count ?? 0) > LOW_POLY_MIN_VERTICES)
        node.geometry.userData.lowPoly = createLowPolyPallet(node.geometry);
    });
    templates.set(asset, template);
  }
  return template.clone(true);
}
