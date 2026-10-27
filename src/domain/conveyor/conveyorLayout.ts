import type { ConveyorTurn, EquipmentPose, SceneEquipment } from "@/types/layout";
import { CONVEYOR_LAYOUT as C } from "@/constants/conveyorLayoutConfig";
import { pathLength, pathLocalPoint, type ConveyorPathId } from "@/domain/conveyor/conveyorPaths";

type BeltPose = EquipmentPose & { conveyorTurn?: ConveyorTurn; conveyorPath?: ConveyorPathId; conveyorLength?: number };
/** Shape-only belt fields; a pose may be passed along (ignored). */
export type BeltShape = Pick<BeltPose,"conveyorTurn"|"conveyorPath"|"conveyorLength"> & Partial<EquipmentPose>;
/** Straight belt length (configurable; default = rail.glb belt). */
export const straightLength = (belt: BeltShape) => belt.conveyorLength && belt.conveyorLength > 0 ? belt.conveyorLength : C.length;
export function beltLength(belt: BeltShape) {
  if (belt.conveyorPath) return pathLength(belt.conveyorPath);
  return !belt.conveyorTurn || belt.conveyorTurn === "straight" ? straightLength(belt) : Math.PI * C.radius / 2;
}
export function beltLocalPoint(belt: BeltShape, distance: number) {
  if (belt.conveyorPath) return pathLocalPoint(belt.conveyorPath, distance);
  const turn = belt.conveyorTurn ?? "straight";
  if (turn === "straight") { const length = straightLength(belt); return { x: 0, z: distance - length / 2, yaw: 0 }; }
  const angle = distance / C.radius, side = turn === "left" ? -1 : 1;
  return { x: side * C.radius * (1 - Math.cos(angle)), z: -C.radius + C.radius * Math.sin(angle), yaw: side * angle };
}
export function beltPoint(belt: BeltPose, distance: number) {
  const p = beltLocalPoint(belt, distance), c = Math.cos(belt.yaw), s = Math.sin(belt.yaw);
  return { x: belt.x + p.x * c + p.z * s, z: belt.z - p.x * s + p.z * c, yaw: belt.yaw + p.yaw };
}
const sameEndpoint = (a: EquipmentPose, b: EquipmentPose) =>
  Math.hypot(a.x-b.x,a.z-b.z)<C.connectionTolerance && Math.cos(a.yaw-b.yaw)>.999;
export function beltConnections(objects: SceneEquipment[]) {
  const belts = objects.filter(o=>o.kind==="conveyor"), next = new Map<string,SceneEquipment>(), incoming = new Set<string>();
  for (const belt of belts) {
    const end = beltPoint(belt,beltLength(belt));
    const target = belts.find(other=>other.id!==belt.id && !incoming.has(other.id) && sameEndpoint(end,beltPoint(other,0)));
    if(target){next.set(belt.id,target);incoming.add(target.id);}
  }
  return {next,incoming};
}
export function extendBelt(belt: BeltPose, turn: ConveyorTurn): BeltPose {
  const end = beltPoint(belt,beltLength(belt));
  return { x:end.x+Math.sin(end.yaw)*C.length/2, z:end.z+Math.cos(end.yaw)*C.length/2, yaw:end.yaw, conveyorTurn:turn };
}
/** Straight-belt body (not a turn or spline path). */
export function isStraightBelt(belt: BeltShape) {
  return !belt.conveyorPath && (belt.conveyorTurn ?? "straight") === "straight";
}
export function connectedBeltIds(objects: SceneEquipment[], id: string) {
  const { next } = beltConnections(objects);
  const neighbors = new Map<string, string[]>();
  for (const [source, target] of next) {
    neighbors.set(source, [...(neighbors.get(source) ?? []), target.id]);
    neighbors.set(target.id, [...(neighbors.get(target.id) ?? []), source]);
  }
  const connected = new Set([id]);
  for (const current of connected) {
    for (const neighbor of neighbors.get(current) ?? []) connected.add(neighbor);
  }
  return connected;
}
export function snapBelt(belt: SceneEquipment, objects: SceneEquipment[]): SceneEquipment {
  const others=objects.filter(o=>o.id!==belt.id&&o.kind==="conveyor"), {next,incoming}=beltConnections(others);
  let best=C.snapDistance, result=belt;
  for(const other of others)for(const input of [true,false]){
    if(input?next.has(other.id):incoming.has(other.id))continue;
    const target=beltPoint(other,input?beltLength(other):0), local=beltLocalPoint(belt,input?0:beltLength(belt));
    const current=beltPoint(belt,input?0:beltLength(belt)), distance=Math.hypot(current.x-target.x,current.z-target.z);
    if(distance>=best)continue;
    const yaw=target.yaw-local.yaw,c=Math.cos(yaw),s=Math.sin(yaw);
    result={...belt,x:target.x-local.x*c-local.z*s,z:target.z+local.x*s-local.z*c,yaw};best=distance;
  }
  return result;
}
