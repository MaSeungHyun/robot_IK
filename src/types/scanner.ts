import type { Vector3 } from "three";

export type ScanResult = "safe" | "fault";

export type ScanSensor = {
  point: Vector3;
  normal: Vector3;
  halfWidth: number;
  floor: number;
};

export type ScannerSnapshot = {
  id: string;
  scanned: number;
  faults: number;
  lastResult: ScanResult | null;
};
