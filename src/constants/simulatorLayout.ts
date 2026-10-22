import type { EquipmentKind, EquipmentPose } from "@/types/layout";

export const SIMULATOR_CONFIG = {
  robotScale: 0.7,
  reach: 1.8,
  navigationPadding: 3,
  grid: 0.2,
  snap: 0.1,
  amrSpeed: 0.8,
  amrTurnRate: Math.PI / 2,
  palletCapacity: 20,
};
export const DEFAULT_LAYOUT: Record<EquipmentKind, EquipmentPose> = {
  robot: { x: 0, z: 0, yaw: 0 },
  pallet: { x: -1.2, z: 0, yaw: 0 },
  conveyor: { x: 1.06875, z: 0, yaw: 0 },
  amr: { x: -2.3, z: -1.8, yaw: 0 },
  dock: { x: -3.2, z: 1.8, yaw: 0 },
  scanner: { x: 1.06875, z: 0, yaw: 0 },
  floor: { x: 0.5, z: 0.5, yaw: 0 },
  rack: { x: -3.2, z: -3.2, yaw: 0 },
  door: { x: 0, z: -5, yaw: 0 },
};
export const EDITOR_HISTORY_LIMIT = 100;
// Floor/wall asset: 1-unit grid cells; wall height snaps to wallStep.
export const FLOOR_CONFIG = {
  cell: 1,
  wallStep: 0.5,
  maxWallHeight: 10,
  maxSize: 100,
  floorColor: "#1b2a3a",
  wallColor: "#8ea9cf",
};
export const AMR_TRAFFIC = {
  emptyRadius: 0.45,
  loadedRadius: 0.82,
  safetyMargin: 0.1,
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
  color: "#38bdf8",
  overlapColor: "#f9c335", // var(--color-warning) warning token
  height: 0.005,
  segments: 80,
  width: 0.01,
  opacity: 0.3,
  fillOpacity: 0.12,
} as const;
