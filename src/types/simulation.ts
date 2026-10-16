export type DemoMode = "robot" | "conveyor" | "amr" | "customize";
export type EquipmentSnapshot={
  elapsed:number;
  robots:{id:string;name:string;utilization:number;count:number;state:"working"|"idle"|"disabled";status:string}[];
  agents:{id:string;name:string;state:"idle"|"pickup"|"loading"|"dispatch"|"unloading"|"returning"|"blocked"|"waiting"|"yielding"|"disabled";status:string;target:string|null;completed:number}[];
  pallets:{id:string;name:string;count:number;capacity:number;shipping:boolean}[];
};
