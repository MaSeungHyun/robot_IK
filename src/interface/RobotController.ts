import type { Group } from "three";
import type { JointAngleReading, RobotPhase, RobotTransferMode, Transfer } from "../types/robot";

/** Runtime control shared by robot models. Angles are expressed in degrees. */
export interface RobotController {
  readonly id: string;
  readonly model: Group;
  readonly running: boolean;
  readonly phase: RobotPhase;
  readonly transferMode: RobotTransferMode;
  start(): void;
  pause(): void;
  /** Restore pose/active cargo. The owner must also reset its queue and conveyor counters. */
  reset(): void;
  /** Called once per simulation frame, including while paused for manual control. */
  update(delta: number): void;
  getJointAngles(): JointAngleReading[];
  setJointAngle(name: string, degrees: number): void;
  /** Stop control and detach held cargo without disposing shared model assets. */
  dispose(): void;
}

export interface RobotControllerOptions {
  id: string;
  model: Group;
  geometryScale?: number;
  /** Horizontal pickup radius in world metres. */
  pickupRadius?: number;
  transferMode?: RobotTransferMode;
  getJobs: () => readonly Transfer[];
  onProgress?: (completed: number, status: string) => void;
}
