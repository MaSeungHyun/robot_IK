import type { Vector3 } from "three";
import { CONVEYOR_LAYOUT } from "@/constants/conveyorLayoutConfig";
import { RAIL_MODEL } from "@/constants/modelPoints.generated";
import { IK_CONFIG } from "@/constants/simulation";
import type { SceneEquipment } from "@/types/layout";

/**
 * Straight rail.glb belts as keep-out volumes for the arm links (the arm bends to the other side instead of
 * passing through a conveyor): the belt bed up to the belt surface, the two side rails up to the frame top.
 * Measured from the model (modelPoints.generated.ts), standing on the floor; the belt runs along local z.
 */
export type KeepOutBox = { x: number; z: number; cos: number; sin: number; halfZ: number };
const HALF_X = CONVEYOR_LAYOUT.width / 2;
const HALF_Z = (RAIL_MODEL.max[2] - RAIL_MODEL.min[2]) / 2;
const BED_HALF = (RAIL_MODEL.beltX[1] - RAIL_MODEL.beltX[0]) / 2;
const BED_TOP = CONVEYOR_LAYOUT.height;
const FRAME_TOP = RAIL_MODEL.max[1] - RAIL_MODEL.min[1];

export function conveyorKeepOut(objects: readonly SceneEquipment[]): KeepOutBox[] {
  // Spline (path) conveyors are excluded like turns; custom-length straights scale the box along z.
  return objects.filter((o) => o.kind === "conveyor" && !o.conveyorPath && (o.conveyorTurn ?? "straight") === "straight")
    .map((o) => ({ x: o.x, z: o.z, cos: Math.cos(o.yaw), sin: Math.sin(o.yaw), halfZ: o.conveyorLength ? HALF_Z + (o.conveyorLength - CONVEYOR_LAYOUT.length) / 2 : HALF_Z }));
}

/** True when a link sphere (radius IK_CONFIG.armLinkRadius) at `p` dips into any belt. */
export function insideKeepOut(p: Vector3, boxes: readonly KeepOutBox[]): boolean {
  const r = IK_CONFIG.armLinkRadius;
  for (const b of boxes) {
    const dx = p.x - b.x, dz = p.z - b.z;
    const lx = Math.abs(dx * b.cos - dz * b.sin), lz = Math.abs(dx * b.sin + dz * b.cos);
    if (lx >= HALF_X + r || lz >= b.halfZ + r) continue;
    if (p.y - r < (lx + r > BED_HALF ? FRAME_TOP : BED_TOP)) return true;
  }
  return false;
}