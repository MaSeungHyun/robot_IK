import type { EquipmentTelemetry } from "@/types/equipment";
import type { ScannerSnapshot } from "@/types/scanner";

export type SimulationSceneMode = "robot" | "conveyor" | "amr" | "simulator";
export type EquipmentSnapshot={
  elapsed:number;
  scanners?: ScannerSnapshot[];
  telemetry?: Record<string, EquipmentTelemetry>;
  robots:{id:string;name:string;utilization:number;count:number;state:"working"|"idle"|"disabled";status:string}[];
  agents:{id:string;name:string;state:"idle"|"pickup"|"loading"|"dispatch"|"unloading"|"returning"|"blocked"|"waiting"|"yielding"|"disabled";status:string;target:string|null;completed:number}[];
  pallets:{id:string;name:string;count:number;capacity:number;shipping:boolean}[];
};
