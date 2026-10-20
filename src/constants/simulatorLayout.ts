import type { EquipmentKind, EquipmentPose } from "@/types/layout";

export const SIMULATOR_CONFIG={robotScale:.7,reach:1.8,navigationPadding:3,grid:.2,snap:.1,amrSpeed:.8,amrTurnRate:Math.PI/2,palletCapacity:20};
export const DEFAULT_LAYOUT:Record<EquipmentKind, EquipmentPose>={
  robot:{x:0,z:0,yaw:0},pallet:{x:-1.2,z:0,yaw:0},conveyor:{x:1.06875,z:0,yaw:0},
  amr:{x:-2.3,z:-1.8,yaw:0},dock:{x:-3.2,z:1.8,yaw:0},scanner:{x:1.06875,z:0,yaw:0},
};
export const EDITOR_HISTORY_LIMIT=100;
export const AMR_TRAFFIC={emptyRadius:.45,loadedRadius:.82,safetyMargin:.1};
// Simulated AMR battery, in % per simulated second (scaled by the AMR speed setting).
export const AMR_BATTERY={initialMin:55,initialMax:95,movingDrain:.08,idleDrain:.005,chargeRate:1.5,chargeBelow:20,chargedAt:95};

export const ROBOT_RANGE_STYLE = {
  color: "#38bdf8",
  overlapColor: "#ef4444",
  height: 0.005,
  segments: 80,
  width: 0.01,
  opacity: 0.4,
  fillOpacity: 0.12,
} as const;
