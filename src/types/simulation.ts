import type { EquipmentTelemetry } from "@/types/equipment";
import type { ScannerSnapshot } from "@/types/scanner";
import type { EquipmentCategory, OperationState } from "@/domain/state/equipmentState";

/** Pallet cycle actor state (domain/cycle) for detail panels. */
export type CycleSnapshot={id:string;kind:"shuttle"|"forklift"|"agv"|"rackm";state:string;label:string;detail:string};
export type EquipmentSnapshot={cycle?:CycleSnapshot[];
  elapsed:number;
  scanners?: ScannerSnapshot[];
  telemetry?: Record<string, EquipmentTelemetry>;
  robots:{id:string;name:string;utilization:number;count:number;state:"working"|"idle"|"disabled";status:string;
    /** Typed state (domain/state/equipmentState). */
    category?:EquipmentCategory;operation?:OperationState}[];
  agents:{id:string;name:string;state:"idle"|"pickup"|"loading"|"dispatch"|"unloading"|"storing"|"returning"|"receiving"|"blocked"|"waiting"|"yielding"|"charging"|"disabled";status:string;target:string|null;completed:number;battery:number;
    category?:EquipmentCategory;operation?:OperationState}[];
  pallets:{id:string;name:string;count:number;capacity:number;shipping:boolean}[];
  /** Per rack, one entry per PalletPoint (RACK_CONFIG.slots order). Display only. */
  racks?:{id:string;slots:{state:"empty"|"reserved"|"stored";content?:"pallet"|"palletBoxes"|"boxes";palletId?:string;boxes?:number;grade?:"normal"|"defect";storedAt?:number}[]}[];
};
