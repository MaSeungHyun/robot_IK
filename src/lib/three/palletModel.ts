import { Group, Mesh } from "three";
import { createLowPolyPallet } from "@/lib/three/lowPolyPallet";
import { STREAM_CONFIG } from "@/constants/simulation";
import { createUnitPallet } from "@/lib/three/modelNormalization";

const templates = new WeakMap<Group, Group>();

/** Pallet-owned dimensions and shared geometry for preview and simulation. */
export function createPalletModel(asset: Group) {
  let template = templates.get(asset);
  if (!template) {
    template = createUnitPallet(asset);
    template.scale.set(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth);
    // Pallets (and what they carry) only receive shadows; see SceneInstances.
    template.traverse((node) => { node.userData.noCastShadow = true; });
    // Static (racked) pallets render with a low-poly stand-in; see SceneInstances LOD.
    template.traverse((node) => {
      if (node instanceof Mesh && !node.geometry.userData.lowPoly) node.geometry.userData.lowPoly = createLowPolyPallet(node.geometry);
    });
    templates.set(asset, template);
  }
  return template.clone(true);
}
