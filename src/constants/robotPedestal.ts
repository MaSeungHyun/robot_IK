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
  place: { point: "robot_arm_point", elevation: 1.1974 },
} as const satisfies Record<Exclude<RobotPedestalKind, "none">, { point: string; elevation: number }>;
