import type { EquipmentTelemetry } from "@/types/equipment";
import { create } from "zustand";
import { ROBOT_PICKING } from "../constants/simulation";
import type { PackingSnapshot } from "@/domain/pallet/packing/packingDiagnostics";
import type { StreamStats } from "../types/conveyor";
import type { JointAngleReading, RobotTransferMode, RobotJointSnapshot } from "../types/robot";
import type { SimulationSceneMode, EquipmentSnapshot } from "../types/simulation";
import { PLAYBACK_LIMITS } from "../constants/playback";

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
  sceneMode: SimulationSceneMode;
  setSceneMode: (value: SimulationSceneMode) => void;
  transferMode: RobotTransferMode;
  setTransferMode: (value: RobotTransferMode) => void;
  diagnostics: PackingSnapshot | null;
  stats: StreamStats;
  run: number;
  running: boolean;
  speed: number;
  setSpeed: (speed: number) => void;
  progress: Progress;
  angles: JointAngleReading[] | null;
  layer: string;
  cell: { x: number; z: number } | null;
  setDiagnostics: (value: PackingSnapshot | null) => void;
  setStats: (value: StreamStats) => void;
  setRun: (value: Update<number>) => void;
  setRunning: (value: Update<boolean>) => void;
  setProgress: (value: Progress) => void;
  setAngles: (value: Update<JointAngleReading[] | null>) => void;
  setLayer: (value: string) => void;
  setCell: (value: { x: number; z: number } | null) => void;
  reset: () => void;
}
const initialStats = (mode: SimulationSceneMode = "simulator"): StreamStats => ({
  spawned: 0,
  placed: 0,
  passed: 0,
  live: mode === "conveyor" ? 3 : 0,
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
  setRobotJointAngles: (id, readings) => set((state) => {
    const current = state.robotJointAngles[id];
    const unchanged = current?.length === readings.length && current.every((joint, index) => {
      const next = readings[index];
      return joint.name === next.name && joint.axis === next.axis && joint.locked === next.locked
        && Math.abs(joint.degrees - next.degrees) < 0.0001 && joint.min === next.min && joint.max === next.max;
    });
    return unchanged ? state : { robotJointAngles: { ...state.robotJointAngles, [id]: readings } };
  }),
  removeRobotJointAngles: (id) => set((state) => {
    if (!state.robotJointAngles[id]) return state;

    const readings = { ...state.robotJointAngles };
    delete readings[id];
    return { robotJointAngles: readings };
  }),
  mockTelemetry: {},
  setMockTelemetry: (mockTelemetry) => set({ mockTelemetry }),
  equipment: null,
  setEquipment: (equipment) => set({ equipment }),
  sceneMode: "simulator",
  setSceneMode: (sceneMode) =>
    set((state) =>
      state.sceneMode === sceneMode
        ? {}
        : {
            sceneMode,
            run: state.run + 1,
            running: false,
            equipment: null,
            diagnostics: null,
            stats: initialStats(sceneMode),
            progress: initialProgress(),
            angles: null,
            robotJointAngles: {},
            mockTelemetry: {},
            layer: "top",
            cell: null,
          },
    ),
  transferMode: ROBOT_PICKING.transferMode,
  setTransferMode: (transferMode) =>
    set((state) =>
      state.transferMode === transferMode
        ? {}
        : {
            transferMode,
            run: state.run + 1,
            running: false,
            diagnostics: null,
            equipment: null,
            stats: initialStats(state.sceneMode),
            progress: initialProgress(),
            angles: null,
            robotJointAngles: {},
            mockTelemetry: {},
            layer: "top",
            cell: null,
          },
    ),
  diagnostics: null,
  stats: initialStats(),
  run: 0,
  running: false,
  progress: initialProgress(),
  angles: null,
  layer: "top",
  cell: null,
  speed: 1,
  setSpeed: (speed) => {
    if (
      Number.isFinite(speed) &&
      speed >= PLAYBACK_LIMITS.min &&
      speed <= PLAYBACK_LIMITS.max
    )
      set({ speed });
  },
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setStats: (stats) => set({ stats }),
  setRun: (value) => set((state) => ({ run: resolve(value, state.run) })),
  setRunning: (value) =>
    set((state) => ({ running: resolve(value, state.running) })),
  setProgress: (progress) => set({ progress }),
  setAngles: (value) =>
    set((state) => ({ angles: resolve(value, state.angles) })),
  setLayer: (layer) => set({ layer }),
  setCell: (cell) => set({ cell }),
  reset: () =>
    set((state) => ({
      run: state.run + 1,
      running: false,
      diagnostics: null,
      equipment: null,
      stats: initialStats(state.sceneMode),
      progress: initialProgress(),
      angles: null,
      robotJointAngles: {},
      mockTelemetry: {},
      layer: "top",
      cell: null,
    })),
}));
