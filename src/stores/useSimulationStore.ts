import { create } from "zustand";
import type { PackingSnapshot } from "../utils/packing/packingDiagnostics";
import type { StreamStats } from "../types/conveyor";
import type { JointAngleReading } from "../types/robot";

type Update<T> = T | ((current: T) => T);
type Progress = { count: number; status: string };
interface SimulationState {
  continuous: boolean;
  diagnostics: PackingSnapshot | null;
  stats: StreamStats;
  run: number;
  running: boolean;
  progress: Progress;
  angles: JointAngleReading[] | null;
  layer: string;
  cell: { x: number; z: number } | null;
  setContinuous: (value: Update<boolean>) => void;
  setDiagnostics: (value: PackingSnapshot | null) => void;
  setStats: (value: StreamStats) => void;
  setRun: (value: Update<number>) => void;
  setRunning: (value: Update<boolean>) => void;
  setProgress: (value: Progress) => void;
  setAngles: (value: Update<JointAngleReading[] | null>) => void;
  setLayer: (value: string) => void;
  setCell: (value: { x: number; z: number } | null) => void;
  reset: (switchMode?: boolean) => void;
}
const initialStats = (): StreamStats => ({ spawned: 3, placed: 0, passed: 0, live: 3, utilization: 0, full: false, size: "" });
const initialProgress = (): Progress => ({ count: 0, status: "초기 자세 · 시작 대기" });
const resolve = <T,>(value: Update<T>, current: T): T => typeof value === "function" ? (value as (current: T) => T)(current) : value;

export const useSimulationStore = create<SimulationState>((set) => ({
  continuous: true, diagnostics: null, stats: initialStats(), run: 0,
  running: false, progress: initialProgress(), angles: null, layer: "top", cell: null,
  setContinuous: value => set(state => ({ continuous: resolve(value, state.continuous) })),
  setDiagnostics: diagnostics => set({ diagnostics }),
  setStats: stats => set({ stats }),
  setRun: value => set(state => ({ run: resolve(value, state.run) })),
  setRunning: value => set(state => ({ running: resolve(value, state.running) })),
  setProgress: progress => set({ progress }),
  setAngles: value => set(state => ({ angles: resolve(value, state.angles) })),
  setLayer: layer => set({ layer }),
  setCell: cell => set({ cell }),
  reset: (switchMode = false) => set(state => ({
    continuous: switchMode ? !state.continuous : state.continuous,
    run: state.run + 1, running: false, diagnostics: null,
    stats: initialStats(), progress: initialProgress(), angles: null, layer: "top", cell: null,
  })),
}));
