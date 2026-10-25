import type { EquipmentPose } from "@/types/layout";

/** Array direction in the object's own frame: "x" = 가로 (local X), "z" = 세로 (local Z). */
export type ArrayAxis = "x" | "z";
export type ArrayOptions = { count: number; gap: number; axis: ArrayAxis };

/**
 * Blender-style Array: poses of the copies 2..count (the source stays copy 1). Step = footprint size along the
 * axis + gap, along the source's rotated local axis; yaw and size are kept (no scale change).
 */
export function arrayPoses(source: EquipmentPose, footprint: readonly [number, number], { count, gap, axis }: ArrayOptions): EquipmentPose[] {
  const n = Math.max(0, Math.floor(count) - 1);
  const step = (axis === "x" ? footprint[0] : footprint[1]) + Math.max(0, gap);
  // Local +X = (cos yaw, -sin yaw), local +Z = (sin yaw, cos yaw) on the floor (three.js Y-up rotation).
  const [dx, dz] = axis === "x" ? [Math.cos(source.yaw), -Math.sin(source.yaw)] : [Math.sin(source.yaw), Math.cos(source.yaw)];
  return Array.from({ length: n }, (_, i) => ({ ...source, x: source.x + dx * step * (i + 1), z: source.z + dz * step * (i + 1) }));
}
