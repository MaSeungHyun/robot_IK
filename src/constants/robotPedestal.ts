/** Robot pedestal (RobotDetails "받침대"): GLB drawn under the arm; the arm base sits on the GLB's *_point empty. */
export type RobotPedestalKind = "none" | "base" | "place";

export const ROBOT_PEDESTAL_OPTIONS: readonly { value: RobotPedestalKind; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "base", label: "베이스" },
  { value: "place", label: "플레이스" },
];

/**
 * point: empty where the arm base stands. elevation: how far the arm is raised (m, native scale 1) = that empty's world
 * height in the authored GLB, or pointHeight + the GLB root's floor offset when the GLB root is not on the floor.
 * pointHeight (default elevation) is checked against the GLB at load (dev warning on mismatch).
 */
export const ROBOT_PEDESTALS = {
  base: { point: "robot_base_point", elevation: 1.1933 },
  // robot_arm_place.glb (per robot, like robot_base): root at the origin, point at y 1.12; its bottom is 0.153 below the root,
  // i.e. 0.072 lower than the factory.glb robot_arm_place.00x copies (bottom -0.081, point 1.1918 = robotarm height).
  place: { point: "robot_arm_place_point", elevation: 1.1918, pointHeight: 1.12 },
} as const satisfies Record<Exclude<RobotPedestalKind, "none">, { point: string; elevation: number; pointHeight?: number }>;


/**
 * Pedestal top face in robot-local XZ (m, yaw 0, relative to the arm base point), measured from the GLB bounds.
 * A fixed pallet whose centre lies inside sits on the pedestal top (elevation above) instead of the floor.
 */
export const ROBOT_PEDESTAL_FOOTPRINTS = {
  base: { minX: -0.727, maxX: 0.674, minZ: -2.945, maxZ: 1.042 },
  place: { minX: -1.089, maxX: 1.052, minZ: -0.881, maxZ: 3.067 },
} as const satisfies Record<Exclude<RobotPedestalKind, "none">, { minX: number; maxX: number; minZ: number; maxZ: number }>;
