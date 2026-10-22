import type { EquipmentTelemetry } from "@/types/equipment";
import type { ScannerSnapshot } from "@/types/scanner";

export type EquipmentSnapshot={
  elapsed:number;
  scanners?: ScannerSnapshot[];
  telemetry?: Record<string, EquipmentTelemetry>;
  robots:{id:string;name:string;utilization:number;count:number;state:"working"|"idle"|"disabled";status:string}[];
  agents:{id:string;name:string;state:"idle"|"pickup"|"loading"|"dispatch"|"unloading"|"storing"|"returning"|"blocked"|"waiting"|"yielding"|"charging"|"disabled";status:string;target:string|null;completed:number;battery:number}[];
  pallets:{id:string;name:string;count:number;capacity:number;shipping:boolean}[];
  /** Per rack, one entry per PalletPoint (RACK_CONFIG.slots order). Display only. */
  racks?:{id:string;slots:{state:"empty"|"reserved"|"stored";palletId?:string;boxes?:number;grade?:"normal"|"defect";storedAt?:number}[]}[];
};
