import type { EquipmentKind, EquipmentPose } from "@/types/layout";
import { MODEL_FOOTPRINT as F } from "@/constants/footprints";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";

/**
 * Max robot pick reach (m), measured on RobotArm.glb at 1:1 with hand04's suction straight down: upper arm
 * (hand01->hand02 1.185 m) and forearm (hand02->hand04 1.313 m) level at shoulder height put the tip at
 * L1 + L2 = 2.498 m from the base axis. Default and input max for robot reach; larger values are clamped.
 */
export const ROBOT_REACH_MAX = 2.5;

export const SIMULATOR_CONFIG = {
  /** Default robot reach (m) = ROBOT_REACH_MAX. */
  reach: ROBOT_REACH_MAX,
  navigationPadding: 3,
  grid: 0.2,
  snap: 0.1,
  amrSpeed: 1.6,
  amrTurnRate: Math.PI / 2,
};
export const AMR_TRAFFIC = {
  /** AMR.glb body at any heading (half diagonal of its footprint). */
  emptyRadius: F.amrRadius,
  /** Body or carried pallet, whichever reaches farther (the pallet sits inside the AMR body). */
  loadedRadius: Math.max(F.amrRadius, F.palletRadius),
  /** Gap (m) kept between moving bodies in traffic control, replans, move guards and joint plans, on top of the
   *  footprints (was 0.1; the footprint discs are already the body's circumscribed circle). */
  safetyMargin: 0.05,
  /** Spacing gap (m) of authored / auto layouts (unchanged 0.1 so existing layouts keep their positions). */
  layoutGap: 0.1,
};
/** Belt centre -> robot, robot -> pallet centre (AMR body at the pallet clears the robot base), from model footprints. */
const beltToRobot = BELT.width / 2 + F.robotRadius + 0.05, robotToPallet = F.robotRadius + AMR_TRAFFIC.loadedRadius + 0.05;
export const DEFAULT_LAYOUT: Record<EquipmentKind, EquipmentPose> = {
  robot: { x: 0, z: 0, yaw: 0 },
  pallet: { x: -robotToPallet, z: 0, yaw: 0 },
  conveyor: { x: beltToRobot, z: 0, yaw: 0 },
  amr: { x: -robotToPallet, z: -2 * AMR_TRAFFIC.loadedRadius - AMR_TRAFFIC.layoutGap, yaw: 0 },
  dock: { x: -robotToPallet, z: 2 * AMR_TRAFFIC.loadedRadius + AMR_TRAFFIC.layoutGap, yaw: 0 },
  scanner: { x: beltToRobot, z: 0, yaw: 0 },
  floor: { x: 0.5, z: 0.5, yaw: 0 },
  rack: { x: -3.2, z: -3.2, yaw: 0 },
  door: { x: 0, z: -5, yaw: 0 },
};
export const EDITOR_HISTORY_LIMIT = 100;
// Floor/wall asset: 1-unit grid cells; wall height snaps to wallStep.
export const FLOOR_CONFIG = {
  cell: 1,
  wallStep: 0.5,
  maxWallHeight: 15,
  maxSize: 150,
  floorColor: "#1b2a3a",
  wallColor: "#8ea9cf",
};
// Simulated AMR battery, in % per simulated second (scaled by the AMR speed setting).
export const AMR_BATTERY = {
  initialMin: 55,
  initialMax: 95,
  movingDrain: 0.08,
  idleDrain: 0.005,
  chargeRate: 1.5,
  chargeBelow: 20,
  chargedAt: 95,
};

export const ROBOT_RANGE_STYLE = {
  color: "#02dfef",
  overlapColor: "#f9c335", // var(--color-warning) warning token
  height: 0.005,
  segments: 80,
  width: 0.01,
  opacity: 0.3,
  fillOpacity: 0.12,
} as const;
