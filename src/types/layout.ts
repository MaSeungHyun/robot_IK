import type { ConveyorPathId } from "@/domain/conveyor/conveyorPaths";
import type { EquipmentMetadata } from "@/types/equipment";

export type EquipmentKind="robot"|"pallet"|"conveyor"|"amr"|"dock"|"scanner"|"floor"|"rack"|"door";
export type EquipmentPose={x:number;z:number;yaw:number};
export type FactoryLayout=Record<Exclude<EquipmentKind,"scanner"|"floor"|"rack"|"door">,EquipmentPose>;
/** Floor/wall room: integer grid cells, centered on the object pose; wallHeight 0 = floor only. */
export type FloorSize={width:number;depth:number;wallHeight:number;/** false: no generated roof (e.g. the template draws its own glb roof). */roof?:boolean};
export type ConveyorTurn="straight"|"left"|"right";
export type SceneEquipment=EquipmentPose&{id:string;kind:EquipmentKind;name:string;metadata?:EquipmentMetadata;conveyorTurn?:ConveyorTurn;/** Spline conveyor: whole glb rail + extracted belt centreline (see domain/conveyor/conveyorPaths). */conveyorPath?:ConveyorPathId;/** Straight belt length in metres (default CONVEYOR_LAYOUT.length). */conveyorLength?:number;floor?:FloorSize;/** Mount height in metres (e.g. a robot on a GLB pedestal; default 0 = floor). */elevation?:number};
/** Inspection grade of a box (unscanned boxes count as normal) and of the pallet that collects it. */
export type CargoGrade="normal"|"defect";
/** Which boxes a robot picks; "all" keeps the original behaviour. */
export type PickFilter="all"|CargoGrade;
/** Pallet grades a dock receives; "any" keeps the original behaviour. */
export type RackStorageMode="pallet"|"boxes"|"both";
/** One rack slot's initial contents: an empty pallet (boxes 0), a loaded pallet, or loose boxes on the shelf (pallet false). */
export type RackSlotContent={slot:number;pallet:boolean;boxes:number};
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
  /** Forklift only, pallet cycle: "service" = swaps pallets on shuttle AMRs (full → Rack_m, empty → AMR), "rack" = Rack_m → Rack and Rack → 출하,
   * "carrier" = holds a pallet on its forks at the pallet in front of it (the robot loads it there) and carries it to an unload dock robot. */
  forkliftTask?:"service"|"rack"|"carrier";
  /** Forklift job split ("emptyReturn" = only lifts emptied pallets off AMRs onto the empty-pallet stack).
   * Service forklift: job split when several forklifts share a cell. "auto" (default) = any job; "unload" = only full
   * pallets AMR → Rack_m; "supply" = only empty pallets (source → AMR, and empty pallets off inbound AMRs → source). */
  forkliftRole?:"auto"|"unload"|"supply"|"emptyReturn";
  /** Pallet / shuttle AMR whose deck pallet is emptied at an unload dock: what happens to the emptied pallet. "forklift" (default) =
   * a forklift lifts it off the AMR and stacks it on the empty-pallet source, then the AMR goes empty for the next pallet; "return" = it rolls off to the
   * return line at the AMR's home; "forklift" = the cell's service forklift lifts it off the AMR at the unload dock and stacks it
   * on the empty-pallet source (palletSource dock), then the AMR goes back for the next loaded pallet. */
  emptyPallet?:"return"|"forklift";
  /** Shuttle AMR only: "mounted" (default) = starts with the pallet on its deck; "forklift" = starts empty and a service
   *  forklift places a pallet from the empty-pallet source (works without a mounted pallet object's position). */
  initialPallet?:"mounted"|"forklift";
  /** Dock (palletSource) only: pallets the empty-pallet stack holds (default 8, see constants/emptyPallet). */
  stackCapacity?:number;
  /** Conveyor only: an AMR may unload its deck boxes itself onto this belt when it leads to a scanner (default on). */
  selfUnload?:boolean;
  /** Conveyor only: seconds between boxes in that self-unload (default 1.6). */
  deckFeedInterval?:number;
  /** Rack only: "mobile" = Rack_m (2 levels, carried by an AGV); default fixed Rack.glb. */
  rackType?:"fixed"|"mobile";
  /** Fixed rack only: what its slots receive. "pallet" (default): a loaded pallet is put in by a forklift / AMR; "boxes": loose boxes only (on the shelf or onto a pallet already in the slot), no pallet-in; "both". */
  rackStorage?:RackStorageMode;
  /** Fixed rack only: slot contents at simulation start (index into RACK_CONFIG.slots); boxes use the pallet stacking layout. */
  rackContents?:RackSlotContent[];
  /** Pallet only: id of the AMR it is mounted on (editor snap; the pallet rides on that shuttle AMR). */
  mountedOn?:string;
  /** Inbound conveyor unit: "box" (default, boxes are palletized onto the AMR pallet) or "pallet" (loaded pallets roll onto a roller-top AMR). */
  inboundUnit?:"box"|"pallet";
  /** Boxes stacked on each inbound pallet (default PALLET_STACKING.defaultBoxes). */
  palletBoxes?:number;
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
/** Model an AMR role renders with: a role change never swaps the model, so roles are offered only within one family. */
export type AmrModel = "amr" | "forklift" | "agv";
export const amrModelOf = (role: string | undefined): AmrModel => (isForkliftRole(role) ? "forklift" : role === "agv" ? "agv" : "amr");
