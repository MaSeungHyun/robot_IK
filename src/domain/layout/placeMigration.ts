import type { SceneTemplate } from "@/types/sceneTemplate";

/**
 * Load-time migration for robot_arm_place: it used to be one long shared platform (old robot_arm_place.glb, added as a
 * template prop). The GLB is now a per-robot pedestal like robot_base (drawn under each "place" robot by RobotPedestal,
 * its robot_arm_place_point on the arm base), so a leftover shared "robotArmPlace" prop is dropped.
 */
export function migrateRobotArmPlace(template: SceneTemplate): SceneTemplate {
  if (!template.props?.some((q) => q.source === "robotArmPlace")) return template;
  return { ...template, props: template.props.filter((q) => q.source !== "robotArmPlace") };
}
