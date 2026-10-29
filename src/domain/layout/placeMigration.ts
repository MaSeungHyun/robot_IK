import { ROBOT_ARM_PLACE } from "@/constants/robotPedestal";
import type { SceneTemplate } from "@/types/sceneTemplate";

/**
 * Load-time migration for the shared robot_arm_place.glb platform: robots with robotPedestal "place" standing over it
 * move onto robot_arm_place_point's mount line (z / yaw of the point; height comes from ROBOT_PEDESTALS.place), the nearest
 * one snaps onto the point itself. The platform itself is added once as a GLB prop.
 */
export function migrateRobotArmPlace(template: SceneTemplate): SceneTemplate {
  const p = ROBOT_ARM_PLACE;
  let changed = false;
  // The place robot nearest robot_arm_place_point stands exactly on it (x too); the others keep x on its mount line.
  // Only when the authored point lies on the platform (robot_arm_place.glb's point is at x -21.02, off its -19.79 edge:
  // snapping there pushed robot 7 off the platform).
  const onPlatform = p.point.x >= p.minX && p.point.x <= p.maxX && p.point.z >= p.minZ && p.point.z <= p.maxZ;
  let nearest = -1, best = Infinity;
  template.equipment.forEach((e, i) => {
    if (e.kind !== "robot" || e.settings?.robotPedestal !== "place") return;
    const d = Math.hypot(e.x - p.point.x, e.z - p.point.z);
    if (onPlatform && d < best && d < 3) { best = d; nearest = i; }
  });
  const equipment = template.equipment.map((e, i) => {
    if (e.kind !== "robot" || e.settings?.robotPedestal !== "place") return e;
    if (e.x < p.minX || e.x > p.maxX || e.z < p.minZ || e.z > p.maxZ) return e;
    const x = i === nearest ? p.point.x : e.x;
    if (e.x === x && e.z === p.point.z && e.yaw === 0) return e;
    changed = true;
    return { ...e, x, z: p.point.z, yaw: 0 };
  });
  const hasPlace = template.equipment.some((e) => e.kind === "robot" && e.settings?.robotPedestal === "place");
  const hasProp = template.props?.some((q) => q.source === "robotArmPlace") ?? false;
  if (!changed && (!hasPlace || hasProp)) return template;
  const props = hasPlace && !hasProp ? [...(template.props ?? []), { source: "robotArmPlace" as const, node: p.node }] : template.props;
  return { ...template, equipment, ...(props ? { props } : {}) };
}
