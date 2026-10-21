import type { RefObject } from "react";
import type { Group, Vector3 } from "three";
import type { PlanningEvent } from "@/domain/pallet/packing/packingDiagnostics";

export type RobotState =
  | "FIND_BOX"
  | "MOVE_TO_BOX"
  | "PICK"
  | "MOVE_TO_PALLET"
  | "PLACE";

export type RobotTransferMode = "base" | "shoulder";

export type RobotPhase = "HOME" | "PRE_GRASP" | "GRASP" | "ATTACH" | "LIFT"
  | "SHOULDER_TRANSFER" | "ALIGN_BASE" | "TRANSIT" | "PRE_PLACE"
  | "PLACE" | "RELEASE" | "RETREAT";

export type Transfer = {
  box: Group;
  pickup: Vector3;
  destination: Vector3;
  moving?: boolean;
  yaw?: number;
  velocity?: Vector3;
  onPick?: () => void;
  onPlace?: () => void;
  onMiss?: () => void;
  available?: () => boolean;
  replanPlacement?: (restart?: boolean) => boolean;
  advancePlacementLevel?: () => boolean;
  onPlanEvent?: (event: PlanningEvent) => void;
};
export type JointAngleReading = { name: string; axis: string; degrees: number; locked: boolean; min: number; max: number; setDegrees: (value: number) => void; worldXYZ?: number[]; downwardTilt?: number };
export type JointAngleRef = RefObject<JointAngleReading[] | null>;

export type RobotJointSnapshot = Pick<JointAngleReading, "name" | "axis" | "degrees" | "locked" | "min" | "max">;
