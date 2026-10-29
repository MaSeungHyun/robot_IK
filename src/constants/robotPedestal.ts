/** Robot pedestal (RobotDetails "받침대"): GLB drawn under the arm; the arm base sits on the GLB's *_point empty. */
export type RobotPedestalKind = "none" | "base" | "place";

export const ROBOT_PEDESTAL_OPTIONS: readonly { value: RobotPedestalKind; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "base", label: "베이스" },
  { value: "place", label: "플레이스" },
];

/**
 * point: empty where the arm base stands. elevation: that empty's world height in the authored GLB (m, native scale 1),
 * i.e. how far the arm is raised. Checked against the GLB at load (dev warning on mismatch).
 */
export const ROBOT_PEDESTALS = {
  base: { point: "robot_base_point", elevation: 1.1933 },
  place: { point: "robot_arm_place_point", elevation: 1.1918, shared: true },
} as const satisfies Record<Exclude<RobotPedestalKind, "none">, { point: string; elevation: number; shared?: boolean }>;

/**
 * robot_arm_place.glb is one long platform shared by the depalletize line (world x ≈ -19.79..22.28, z ≈ 36.25..40.20):
 * drawn once as a template prop at its authored transform, not per robot. Its robot_arm_place_point (world) is the
 * mount line: robots on it stand at point z / height (see placeMigration.ts).
 */
export const ROBOT_ARM_PLACE = { node: "robot_arm_place", point: { x: -21.019, y: 1.1918, z: 37.1468 }, minX: -19.79, maxX: 22.28, minZ: 36.25, maxZ: 40.2 } as const;

/**
 * Pedestal top face in robot-local XZ (m, yaw 0, relative to the arm base point), measured from the GLB bounds.
 * A fixed pallet whose centre lies inside sits on the pedestal top (elevation above) instead of the floor.
 */
export const ROBOT_PEDESTAL_FOOTPRINTS = {
  base: { minX: -0.727, maxX: 0.674, minZ: -2.945, maxZ: 1.042 },
  place: { minX: -4.686, maxX: 4.704, minZ: -0.876, maxZ: 3.072 },
} as const satisfies Record<Exclude<RobotPedestalKind, "none">, { minX: number; maxX: number; minZ: number; maxZ: number }>;
