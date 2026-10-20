import type { EquipmentMetadata } from "@/types/equipment";

export type EquipmentKind="robot"|"pallet"|"conveyor"|"amr"|"dock"|"scanner"|"floor";
export type EquipmentPose={x:number;z:number;yaw:number};
export type FactoryLayout=Record<Exclude<EquipmentKind,"scanner"|"floor">,EquipmentPose>;
/** Floor/wall room: integer grid cells, centered on the object pose; wallHeight 0 = floor only. */
export type FloorSize={width:number;depth:number;wallHeight:number};
export type ConveyorTurn="straight"|"left"|"right";
export type SceneEquipment=EquipmentPose&{id:string;kind:EquipmentKind;name:string;metadata?:EquipmentMetadata;conveyorTurn?:ConveyorTurn;floor?:FloorSize};
export type EquipmentSettings={speed:number;reach:number;capacity:number;spawnInterval:number;enabled:boolean;defectRate?:number};
