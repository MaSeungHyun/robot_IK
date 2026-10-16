export type EquipmentKind="robot"|"pallet"|"conveyor"|"amr"|"dock";
export type EquipmentPose={x:number;z:number;yaw:number};
export type FactoryLayout=Record<EquipmentKind,EquipmentPose>;
export type ConveyorTurn="straight"|"left"|"right";
export type SceneEquipment=EquipmentPose&{id:string;kind:EquipmentKind;name:string;conveyorTurn?:ConveyorTurn};
export type EquipmentSettings={speed:number;reach:number;capacity:number;spawnInterval:number;enabled:boolean};
