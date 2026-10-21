import { Group } from "three";
import { STREAM_CONFIG } from "@/constants/simulation";
import { createUnitPallet } from "@/lib/three/modelNormalization";

const templates = new WeakMap<Group, Group>();

/** Pallet-owned dimensions and shared geometry for preview and simulation. */
export function createPalletModel(asset: Group) {
  let template = templates.get(asset);
  if (!template) {
    template = createUnitPallet(asset);
    template.scale.set(STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletHeight, STREAM_CONFIG.palletDepth);
    templates.set(asset, template);
  }
  return template.clone(true);
}
