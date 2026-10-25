import type { EquipmentMetadata } from "@/types/equipment";

export type EquipmentKind="robot"|"pallet"|"conveyor"|"amr"|"dock"|"scanner"|"floor"|"rack"|"door";
export type EquipmentPose={x:number;z:number;yaw:number};
export type FactoryLayout=Record<Exclude<EquipmentKind,"scanner"|"floor"|"rack"|"door">,EquipmentPose>;
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
  acceptGrade?:DockAcceptGrade;
  /** Door only: opening width/height in m and whether it is open (persisted = initial state). */
  doorWidth?:number;doorHeight?:number;doorOpen?:boolean;
  /** AMR role: "forklift" = rack-unloading forklift (ForkliftController; legacy "rack" means the same); default pallet AMR.
   * Pallet cycle (domain/cycle): "shuttle" = AMR carrying a pallet on its deck (robot loads it in place), "agv" = Rack_m lifting AGV. */
  amrRole?:"pallet"|"forklift"|"rack"|"shuttle"|"agv";
  /** Forklift only, pallet cycle: "service" = swaps pallets on shuttle AMRs (full → Rack_m, empty → AMR), "rack" = Rack_m → Rack and Rack → 출하. */
  forkliftTask?:"service"|"rack";
  /** Rack only: "mobile" = Rack_m (2 levels, carried by an AGV); default fixed Rack.glb. */
  rackType?:"fixed"|"mobile";
  /** Pallet only: id of the AMR it is mounted on (editor snap; the pallet rides on that shuttle AMR). */
  mountedOn?:string;
  /** Inbound conveyor unit: "box" (default, boxes are palletized onto the AMR pallet) or "pallet" (loaded pallets roll onto a roller-top AMR). */
  inboundUnit?:"box"|"pallet";
  /** Conveyor only: 자동 생성 — the belt start spawns boxes (or loaded pallets in pallet-inbound mode). Newly placed conveyors
   * get false (cargo only enters through the flow); absent = legacy scenes, treated as on. */
  autoSpawn?:boolean;
  /** Conveyor role (rail.glb as is): "box" spawns boxes (default), "inbound" = 입하 box feed, "fed" = boxes only come from
   * a depalletizing robot (no spawning), "outbound" = 출하 pallet conveyor (an AMR's top roller hands its pallet over). */
  conveyorRole?:ConveyorRole;
  /** Dock role: "ship" = outbound sink (default), "unload" = depalletizing station (a robot unloads the pallet onto a belt).
   * Pallet cycle: "service" = shuttle AMR pallet swap point, "palletSource" = empty pallet stack (infinite),
   * "rackDrop" = Rack_m drop point in the rack zone, "stage" = floor spot next to the outbound robot (rack pallet → ship belt). */
  dockRole?:"ship"|"unload"|"service"|"palletSource"|"rackDrop"|"stage";
  /** Robot role: "palletize" = belt -> pallet (default), "depalletize" = unload-dock pallet -> belt. */
  robotRole?:"palletize"|"depalletize"};
export type ConveyorRole="box"|"inbound"|"fed"|"outbound"|"ship";

/** Forklift role, including the legacy "rack" value saved by older scenes. */
export const isForkliftRole = (role: string | undefined) => role === "forklift" || role === "rack";
