import type { EquipmentMetadata } from "@/types/equipment";

export type EquipmentKind="robot"|"pallet"|"conveyor"|"amr"|"dock"|"scanner"|"floor"|"rack";
export type EquipmentPose={x:number;z:number;yaw:number};
export type FactoryLayout=Record<Exclude<EquipmentKind,"scanner"|"floor"|"rack">,EquipmentPose>;
/** Floor/wall room: integer grid cells, centered on the object pose; wallHeight 0 = floor only. */
export type FloorSize={width:number;depth:number;wallHeight:number};
export type ConveyorTurn="straight"|"left"|"right";
export type SceneEquipment=EquipmentPose&{id:string;kind:EquipmentKind;name:string;metadata?:EquipmentMetadata;conveyorTurn?:ConveyorTurn;floor?:FloorSize};
/** Inspection grade of a box (unscanned boxes count as normal) and of the pallet that collects it. */
export type CargoGrade="normal"|"defect";
/** Which boxes a robot picks; "all" keeps the original behaviour. */
export type PickFilter="all"|CargoGrade;
/** Pallet grades a dock receives; "any" keeps the original behaviour. */
export type DockAcceptGrade="any"|CargoGrade;
export type EquipmentSettings={speed:number;reach:number;capacity:number;
  /** Conveyor inlet: seconds between boxes (real time once `beltSpeed` is set; legacy = scaled by `speed`). */
  spawnInterval:number;enabled:boolean;defectRate?:number;
  /** Conveyor only: belt velocity in m/s (absent = legacy `speed` multiplier). */
  beltSpeed?:number;
  /** AMR only: max travel speed in m/s (absent = legacy `speed` multiplier). */
  amrSpeed?:number;
  /** Robot only; default "all". */
  pickFilter?:PickFilter;
  /** Pallet only; default "normal". */
  grade?:CargoGrade;
  /** Dock and rack; default "any". */
  acceptGrade?:DockAcceptGrade};
