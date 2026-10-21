import { Vector3 } from "three";
import type { FactoryLayout,EquipmentKind,EquipmentPose,ConveyorTurn } from "@/types/layout";
import { SIMULATOR_CONFIG as C,AMR_TRAFFIC } from "@/constants/simulatorLayout";
import { findPathBetween } from "@/domain/amr/navigation/pathfinding";
import type { Cell } from "@/domain/amr/navigation/pathfinding";
import { STREAM_CONFIG } from "@/constants/simulation";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { RACK_CONFIG } from "@/constants/rack";

export function footprint(kind:EquipmentKind):[number,number]{
  return kind==="conveyor"?[.35,2.625]:kind==="pallet"?[STREAM_CONFIG.palletWidth,STREAM_CONFIG.palletDepth]:kind==="dock"?[1.3,1.3]:kind==="rack"?RACK_CONFIG.footprint:[.65,.65];
}
export function clearanceAt(x:number,z:number,kind:keyof FactoryLayout,layout:FactoryLayout){
  return clearancePose(x,z,kind,layout[kind]);
}
export function clearancePose(x:number,z:number,kind:EquipmentKind,pose:EquipmentPose&{conveyorTurn?:ConveyorTurn}){
  const dx=x-pose.x,dz=z-pose.z,c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
  if(kind==="conveyor"&&pose.conveyorTurn&&pose.conveyorTurn!=="straight"){
    const side=pose.conveyorTurn==="left"?-1:1,lx=dx*c-dz*s,lz=dx*s+dz*c;
    const angle=Math.atan2(lz+BELT.radius,BELT.radius-side*lx);
    const endpointDistance=Math.min(Math.hypot(lx,lz+BELT.radius),Math.hypot(lx-side*BELT.radius,lz));
    const distance=angle>=0&&angle<=Math.PI/2?Math.min(endpointDistance,Math.abs(Math.hypot(BELT.radius-side*lx,lz+BELT.radius)-BELT.radius)):endpointDistance;
    return Math.max(0,distance-BELT.width/2);
  }
  const [width,depth]=footprint(kind);
  const px=Math.max(0,Math.abs(dx*c-dz*s)-width/2),pz=Math.max(0,Math.abs(dx*s+dz*c)-depth/2);
  return Math.hypot(px,pz);
}
export function validateLayout(layout:FactoryLayout):string[]{
  const errors:string[]=[];
  for(const [kind,pose] of Object.entries(layout))if(![pose.x,pose.z,pose.yaw].every(Number.isFinite))errors.push(`${kind}: 위치와 회전을 확인해 주세요.`);
  const robot=layout.robot,pallet=layout.pallet,belt=layout.conveyor;
  const reach=(x:number,z:number)=>Math.hypot(x-robot.x,z-robot.z)<=C.reach;
  if(!reach(belt.x,belt.z))errors.push("컨베이어 집기 지점이 로봇 도달 범위 밖입니다.");
  for(const x of [-.44,.44])for(const z of [-.4125,.4125]){
    const px=pallet.x+x*Math.cos(pallet.yaw)+z*Math.sin(pallet.yaw),pz=pallet.z-x*Math.sin(pallet.yaw)+z*Math.cos(pallet.yaw);
    if(!reach(px,pz)&&!errors.some(e=>e.includes("팔레트 적재")))errors.push("팔레트 적재 지점이 로봇 도달 범위 밖입니다.");
  }
  if(clearanceAt(robot.x,robot.z,"conveyor",layout)<.38)errors.push("로봇 베이스와 컨베이어가 겹칩니다.");
  if(clearanceAt(robot.x,robot.z,"pallet",layout)<.32)errors.push("로봇 베이스와 팔레트가 겹칩니다.");
  if(clearanceAt(pallet.x,pallet.z,"conveyor",layout)<.85)errors.push("팔레트와 컨베이어 사이를 벌려 주세요.");
  if(clearanceAt(layout.amr.x,layout.amr.z,"robot",layout)<.4||clearanceAt(layout.amr.x,layout.amr.z,"conveyor",layout)<.4)errors.push("AMR 시작 위치가 다른 설비와 겹칩니다.");
  if(!errors.length&&(!layoutPath(layout,layout.amr,layout.pallet,false)||!layoutPath(layout,layout.pallet,layout.dock,true)))errors.push("AMR이 팔레트와 출고 구역을 연결할 수 없습니다.");
  return errors;
}
export type NavigationObstacle={kind:EquipmentKind;pose:EquipmentPose;radius?:number;path?:readonly Vector3[]};
function loadedOverlaps(x:number,z:number,yaw:number,kind:EquipmentKind,pose:EquipmentPose&{conveyorTurn?:ConveyorTurn}){
  const [width,depth]=footprint(kind),[palletWidth,palletDepth]=footprint("pallet");
  const ac=Math.cos(yaw),as=Math.sin(yaw),bc=Math.cos(pose.yaw),bs=Math.sin(pose.yaw);
  const axes=[[ac,-as],[as,ac],[bc,-bs],[bs,bc]];
  for(const [nx,nz] of axes){
    const a=palletWidth/2*Math.abs(nx*ac-nz*as)+palletDepth/2*Math.abs(nx*as+nz*ac);
    const b=width/2*Math.abs(nx*bc-nz*bs)+depth/2*Math.abs(nx*bs+nz*bc);
    if(Math.abs((x-pose.x)*nx+(z-pose.z)*nz)>=a+b+.01-1e-8)return false;
  }
  return true;
}
function navigationClear(layout:FactoryLayout,x:number,z:number,loaded:boolean,extra:NavigationObstacle[]){
  const radius=loaded?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius;
  const clears=(kind:EquipmentKind,pose:EquipmentPose&{conveyorTurn?:ConveyorTurn})=>loaded&&!(kind==="conveyor"&&pose.conveyorTurn&&pose.conveyorTurn!=="straight")?!loadedOverlaps(x,z,layout.pallet.yaw,kind,pose):clearancePose(x,z,kind,pose)>=radius-1e-8;
  return clears("robot",layout.robot)&&clears("conveyor",layout.conveyor)&&!extra.some(o=>o.radius!==undefined||o.path?.length?obstacleClearance(x,z,o)<radius-1e-8:!clears(o.kind,o.pose));
}
export function obstacleClearance(x:number,z:number,obstacle:NavigationObstacle){
  if(obstacle.path?.length){
    let distance=Infinity;
    for(let i=0;i<obstacle.path.length;i++){
      const a=obstacle.path[i],b=obstacle.path[Math.min(i+1,obstacle.path.length-1)],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
      const t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length)):0;
      distance=Math.min(distance,Math.hypot(x-a.x-t*dx,z-a.z-t*dz));
    }
    return Math.max(0,distance-(obstacle.radius??0));
  }
  return obstacle.radius!==undefined?Math.max(0,Math.hypot(x-obstacle.pose.x,z-obstacle.pose.z)-obstacle.radius):clearancePose(x,z,obstacle.kind,obstacle.pose);
}
export function routeFailureReason(layout:FactoryLayout,start:{x:number;z:number},goal:{x:number;z:number},loaded:boolean,extra:NavigationObstacle[],stage:string){
  const blocked=(point:{x:number;z:number})=>!navigationClear(layout,point.x,point.z,loaded,extra.filter(o=>!o.path?.length));
  if(blocked(start))return `${stage}: 출발 공간이 부족합니다. 주변 장비 간격을 확인해 주세요.`;
  if(blocked(goal))return `${stage}: 도착 공간이 부족합니다. 주변 장비 간격을 확인해 주세요.`;
  if(extra.some(o=>o.path?.length))return `${stage}: 다른 AMR의 운반·복귀 경로 예약이 해제되기를 기다립니다.`;
  return `${stage}: 연결 가능한 통로가 없습니다. 장비 배치를 확인해 주세요.`;
}
export function layoutPath(layout:FactoryLayout,start:{x:number;z:number},goal:{x:number;z:number},loaded:boolean,extra:NavigationObstacle[]=[]):Vector3[]|null{
  const radius=loaded?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius,padding=C.navigationPadding;
  const clear=(x:number,z:number)=>navigationClear(layout,x,z,loaded,extra);
  if(!clear(start.x,start.z)||!clear(goal.x,goal.z))return null;
  const segmentClear=(a:{x:number;z:number},b:{x:number;z:number})=>{
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.025));
    for(let i=0;i<=steps;i++){const t=i/steps;if(!clear(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t))return false;}return true;
  };
  // Build a local search region around the trip and nearby obstacles, independent of world origin.
  let minX=Math.min(start.x,goal.x)-padding,maxX=Math.max(start.x,goal.x)+padding;
  let minZ=Math.min(start.z,goal.z)-padding,maxZ=Math.max(start.z,goal.z)+padding;
  const obstacles:NavigationObstacle[]=[{kind:"robot",pose:layout.robot},{kind:"conveyor",pose:layout.conveyor},...extra];
  const included=new Set<NavigationObstacle>();
  let expanded=true;
  while(expanded){
    expanded=false;
    for(const obstacle of obstacles){
      if(included.has(obstacle))continue;
      const [width,depth]=footprint(obstacle.kind),extent=(obstacle.radius??Math.hypot(width,depth)/2)+radius;
      const {x,z}=obstacle.pose;
      if(x+extent<minX||x-extent>maxX||z+extent<minZ||z-extent>maxZ)continue;
      included.add(obstacle);expanded=true;
      minX=Math.min(minX,x-extent-padding);maxX=Math.max(maxX,x+extent+padding);
      minZ=Math.min(minZ,z-extent-padding);maxZ=Math.max(maxZ,z+extent+padding);
      for(const point of obstacle.path??[]){minX=Math.min(minX,point.x-extent-padding);maxX=Math.max(maxX,point.x+extent+padding);minZ=Math.min(minZ,point.z-extent-padding);maxZ=Math.max(maxZ,point.z+extent+padding);}
    }
  }
  minX=Math.floor(minX/C.grid)*C.grid;minZ=Math.floor(minZ/C.grid)*C.grid;
  const columns=Math.ceil((maxX-minX)/C.grid)+1,rows=Math.ceil((maxZ-minZ)/C.grid)+1;
  const blocked=new Set<number>();
  for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
    const wx=x*C.grid+minX,wz=z*C.grid+minZ;
    if(!clear(wx,wz))blocked.add(z*columns+x);
  }
  const world=([x,z]:Cell)=>({x:x*C.grid+minX,z:z*C.grid+minZ});
  const connectors=(point:{x:number;z:number}):Cell[]=>{
    const cx=Math.round((point.x-minX)/C.grid),cz=Math.round((point.z-minZ)/C.grid),candidates:Cell[]=[];
    for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
      const x=cx+dx,z=cz+dz;
      if(x<0||z<0||x>=columns||z>=rows||blocked.has(z*columns+x))continue;
      const cell:Cell=[x,z];if(segmentClear(point,world(cell)))candidates.push(cell);
    }
    return candidates.sort((a,b)=>Math.hypot(world(a).x-point.x,world(a).z-point.z)-Math.hypot(world(b).x-point.x,world(b).z-point.z)).slice(0,8);
  };
  const edges=new Map<string,boolean>();
  const canTraverse=(a:Cell,b:Cell)=>{
    const ai=a[1]*columns+a[0],bi=b[1]*columns+b[0],key=ai<bi?`${ai}:${bi}`:`${bi}:${ai}`;
    let result=edges.get(key);if(result===undefined){result=segmentClear(world(a),world(b));edges.set(key,result);}return result;
  };
  const result=findPathBetween({columns,rows,blocked,canTraverse},connectors(start),connectors(goal));
  if(!result)return null;
  const points=[new Vector3(start.x,0,start.z),...result.map(([x,z])=>new Vector3(x*C.grid+minX,0,z*C.grid+minZ)),new Vector3(goal.x,0,goal.z)];
  for(let i=1;i<points.length;i++){
    const length=points[i].distanceTo(points[i-1]),steps=Math.max(1,Math.ceil(length/.025));
    for(let n=0;n<=steps;n++){
      const t=n/steps,x=points[i-1].x+(points[i].x-points[i-1].x)*t,z=points[i-1].z+(points[i].z-points[i-1].z)*t;
      if(!clear(x,z))return null;
    }
  }
  return points;
}
