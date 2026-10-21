import type { Placement } from "@/domain/pallet/packing/onlinePacking";

export type PlanningEvent = { state:"searching"|"rejected"|"ready"; reason:string; phase:"quick"|"precise" };
export type CandidateView = Placement & {rank:number;state:"pending"|"searching"|"rejected"|"ready"|"placed";reason:string;phase:string};
export type PackingSnapshot = {
  columns:number; rows:number; cell:number; heights:number[];
  palletNumber:number; completedPallets:number; capacityFill:number; floorFill:number;
  inspected:number; candidateCount:number; selected:CandidateView|null;
  candidates:CandidateView[]; boxes:(Placement&{id:number})[];
  phase:string; reason:string; exchanging:boolean;
  sequence?:{perLayer:number;layer:number;placedInLayer:number;nextOrder:number};
};
export const candidateKey=(p:Placement)=>`${p.x}:${p.z}:${p.bottom}:${p.yaw}`;
