import type { EquipmentTelemetry } from "@/types/equipment";
import { create } from "zustand";
import { ROBOT_PICKING } from "../constants/simulation";
import type { StreamStats } from "../types/conveyor";
import type { RobotTransferMode, RobotJointSnapshot } from "../types/robot";
import type { EquipmentSnapshot } from "../types/simulation";
// PLAYBACK_LIMITS (../constants/playback) is unused while the playback cap is removed; re-import it with the check below.

type Update<T> = T | ((current: T) => T);
type Progress = { count: number; status: string };
interface SimulationState {
  robotJointAngles: Record<string, RobotJointSnapshot[]>;
  setRobotJointAngles: (id: string, readings: RobotJointSnapshot[]) => void;
  removeRobotJointAngles: (id: string) => void;
  mockTelemetry: Record<string, EquipmentTelemetry>;
  setMockTelemetry: (readings: Record<string, EquipmentTelemetry>) => void;
  equipment: EquipmentSnapshot | null;
  setEquipment: (equipment: EquipmentSnapshot | null) => void;
  transferMode: RobotTransferMode;
  stats: StreamStats;
  /** Bumped by reset(): remounts the simulation scene (Viewport's SceneBoundary key). */
  run: number;
  /** Play/pause of the simulation (edit vs play mode is useSceneStore.editing). */
  running: boolean;
  speed: number;
  setSpeed: (speed: number) => void;
  progress: Progress;
  setStats: (value: StreamStats) => void;
  setRunning: (value: Update<boolean>) => void;
  setProgress: (value: Progress) => void;
  reset: () => void;
}
const initialStats = (): StreamStats => ({
  spawned: 0,
  placed: 0,
  passed: 0,
  live: 0,
  utilization: 0,
  full: false,
  size: "",
});
const initialProgress = (): Progress => ({
  count: 0,
  status: "초기 자세 · 시작 대기",
});
const resolve = <T>(value: Update<T>, current: T): T =>
  typeof value === "function" ? (value as (current: T) => T)(current) : value;

export const useSimulationStore = create<SimulationState>((set) => ({
  robotJointAngles: {},
  setRobotJointAngles: (id, readings) =>
    set((state) => {
      const current = state.robotJointAngles[id];
      const unchanged =
        current?.length === readings.length &&
        current.every((joint, index) => {
          const next = readings[index];
          return (
            joint.name === next.name &&
            joint.axis === next.axis &&
            joint.locked === next.locked &&
            Math.abs(joint.degrees - next.degrees) < 0.0001 &&
            joint.min === next.min &&
            joint.max === next.max
          );
        });
      return unchanged
        ? state
        : { robotJointAngles: { ...state.robotJointAngles, [id]: readings } };
    }),
  removeRobotJointAngles: (id) =>
    set((state) => {
      if (!state.robotJointAngles[id]) return state;

      const readings = { ...state.robotJointAngles };
      delete readings[id];
      return { robotJointAngles: readings };
    }),
  mockTelemetry: {},
  setMockTelemetry: (mockTelemetry) => set({ mockTelemetry }),
  equipment: null,
  setEquipment: (equipment) => set({ equipment }),
  transferMode: ROBOT_PICKING.transferMode,
  stats: initialStats(),
  run: 0,
  running: false,
  progress: initialProgress(),
  speed: 1,
  setSpeed: (speed) => {
    // if (
    //   Number.isFinite(speed) &&
    //   speed >= PLAYBACK_LIMITS.min &&
    //   speed <= PLAYBACK_LIMITS.max
    // )
    set({ speed });
  },
  setStats: (stats) => set({ stats }),
  setRunning: (value) =>
    set((state) => ({ running: resolve(value, state.running) })),
  setProgress: (progress) => set({ progress }),
  reset: () =>
    set((state) => ({
      run: state.run + 1,
      running: false,
      equipment: null,
      stats: initialStats(),
      progress: initialProgress(),
      robotJointAngles: {},
      mockTelemetry: {},
    })),
}));
