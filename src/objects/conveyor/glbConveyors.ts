import { Box3, Group, Vector3 } from "three";
import type { Object3D } from "three";
import type { ConveyorPathId } from "@/domain/conveyor/conveyorPaths";
import factoryGlbUrl from "@/constants/templates/factory.glb?url";
import { MODEL } from "@/viewport/models/modelUrls";
import { findGlbNode, stripLights } from "@/lib/three/glbNode";

/** Optional (models_original builds may not ship it): rail_in_out.glb, the 11.7 m 입하/출하 rail. */
export const railInOutUrl = Object.entries(import.meta.glob<string>("/src/assets/models/rail_in_out.glb", { query: "?url", import: "default", eager: true }))[0]?.[1];

/** Where each spline conveyor's whole rail mesh comes from and its authored node transform (y, rotation, scale). */
export const PATH_SOURCES: Record<ConveyorPathId, { url: string; node: string }> = {
  rail_c: { url: MODEL.railC, node: "rail_c" },
  rail_001: { url: factoryGlbUrl, node: "rail.001" },
};
const AUTHORED: Record<ConveyorPathId, { y: number; quaternion?: [number, number, number, number]; scale?: [number, number, number] }> = {
  rail_c: { y: 0.5899 },
  rail_001: { y: 0.9577, quaternion: [1, 0, 0, 0], scale: [-1, -1, -1] },
};

/** Whole glb rail at its authored transform, relative to the entity (pose = node translation x/z, yaw 0). Never cut. */
export function pathConveyorModel(id: ConveyorPathId, scene: Object3D) {
  // Only a single-asset glb (rail_c.glb) may fall back to its whole scene; never the full factory.glb.
  const source = PATH_SOURCES[id];
  const found = findGlbNode(scene, source.node) ?? (source.url === factoryGlbUrl ? undefined : scene);
  if (!found) { console.warn(`[glbConveyors] node "${source.node}" not found`); return new Group(); }
  const node = stripLights(found.clone(true)), a = AUTHORED[id];
  node.position.set(0, a.y, 0);
  if (a.quaternion) node.quaternion.set(...a.quaternion); else node.quaternion.identity();
  if (a.scale) node.scale.set(...a.scale); else node.scale.set(1, 1, 1);
  const group = new Group();
  group.add(node);
  return group;
}

/**
 * rail_in_out.glb at its native scale and length (never stretched): the root node's x/z go to the entity pose (the
 * entity sits on the node origin = mesh centre), its authored y/rotation/scale are kept. Belt logic uses
 * {@link railInOutLength} of this same asset.
 */
export function railInOutModel(scene: Object3D) {
  const asset = stripLights(scene.clone(true));
  for (const child of asset.children) child.position.set(0, child.position.y, 0);
  const group = new Group();
  group.add(asset);
  return group;
}

/** Native z extent (m) of rail_in_out.glb; what a 입하/출하 conveyor's `conveyorLength` must be. */
export function railInOutLength(scene: Object3D) {
  const asset = scene.clone(true);
  for (const child of asset.children) child.position.set(0, child.position.y, 0);
  return new Box3().setFromObject(asset).getSize(new Vector3()).z;
}