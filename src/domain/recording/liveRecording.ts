/**
 * Opt-in in-app recording (same SimRecording v1 as the headless runs). Enable with `?record=1` in the URL or
 * `localStorage.setItem("sf.record", "1")` and reload. Read it from the page with `window.__sfRecording()`
 * (or `window.__sfRunCapture()` = { version: 1, capturedAt, simTime, stats, recording }). Off = no cost.
 */
import type { Object3D, Vector3 } from "three";
import { SimRecorder, type SimRecorderHooks } from "@/domain/recording/SimRecorder";
import type { CargoRegistry } from "@/domain/cargo/CargoRegistry";
import type { SimRecording } from "@/domain/recording/simRecording";

export function liveRecordingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("record") === "1" || window.localStorage.getItem("sf.record") === "1";
  } catch { return false; }
}

let current: SimRecorder | null = null;
let now = () => 0;
let stats: () => unknown = () => null;

type Capture = { version: 1; capturedAt: string; simTime: number; stats: unknown; recording: SimRecording | null };
type Win = { __sfRecording?: () => SimRecording | null; __sfRunCapture?: () => Capture };

export function startLiveRecording(root: Object3D, cargo: CargoRegistry, simTime: () => number, getStats: () => unknown,
  meta: { template: string; seed: number }, hooks: SimRecorderHooks = {}): void {
  if (!liveRecordingEnabled()) return;
  now = simTime; stats = getStats;
  current = new SimRecorder(root, cargo, { ...meta, seconds: 0 }, hooks);
  const w = window as unknown as Win;
  w.__sfRecording = () => current && { ...current.data, seconds: Math.round(now() * 1000) / 1000 };
  w.__sfRunCapture = () => ({ version: 1, capturedAt: new Date().toISOString(), simTime: now(), stats: stats(), recording: w.__sfRecording!() });
}
export function stopLiveRecording(): void { current = null; }
export function liveRecordFrame(): void { current?.frame(now()); }
export function liveSuction(robotId: string, on: boolean, box: Object3D, tool: Vector3): void { current?.suction(now(), robotId, on, box, tool); }
