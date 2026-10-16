import type { SceneEquipment,EquipmentSettings } from "../../types/layout";

export function validateScene(objects:SceneEquipment[],settings:Record<string,EquipmentSettings>):string[]{
  const errors:string[]=[],robots=objects.filter(o=>o.kind==="robot"&&settings[o.id].enabled),pallets=objects.filter(o=>o.kind==="pallet"&&settings[o.id].enabled),belts=objects.filter(o=>o.kind==="conveyor"&&settings[o.id].enabled);
  if(!robots.length||!pallets.length||!belts.length)errors.push("로봇 · 팔레트 · 컨베이어를 각각 하나 이상 배치해 주세요.");
  for(const object of objects){
    if(![object.x,object.z,object.yaw].every(Number.isFinite))errors.push(`${object.name}: 위치와 회전을 확인해 주세요.`);
    const value=settings[object.id];
    if(!value||!Number.isFinite(value.speed)||value.speed<=0)errors.push(`${object.name}: 작동 속도를 확인해 주세요.`);
  }
  for(const pallet of pallets)if(!robots.some(robot=>Math.hypot(robot.x-pallet.x,robot.z-pallet.z)+.55<=settings[robot.id].reach))errors.push(`${pallet.name}: 로봇의 적재 범위 안에 놓아 주세요.`);
  if(robots.length&&belts.length&&!robots.some(robot=>belts.some(belt=>Math.hypot(robot.x-belt.x,robot.z-belt.z)<settings[robot.id].reach)))errors.push("로봇 범위 안에 컨베이어를 놓아 주세요.");
  if(objects.some(o=>o.kind==="amr")&&!objects.some(o=>o.kind==="dock"))errors.push("AMR 운반을 위해 출고 구역을 배치해 주세요.");
  return errors;
}
