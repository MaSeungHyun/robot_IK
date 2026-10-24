import { Vector3 } from "three";
import type { FactoryLayout,EquipmentKind,EquipmentPose,ConveyorTurn } from "@/types/layout";
import { SIMULATOR_CONFIG as C,AMR_TRAFFIC } from "@/constants/simulatorLayout";
import { findPathBetween } from "@/domain/amr/navigation/pathfinding";
import type { Cell } from "@/domain/amr/navigation/pathfinding";
import { STREAM_CONFIG } from "@/constants/simulation";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { RACK_CONFIG } from "@/constants/rack";
import { SCAN_TUNNEL } from "@/domain/conveyor/scanTunnel";
import { MODEL_FOOTPRINT as F } from "@/constants/footprints";

export function footprint(kind:EquipmentKind):[number,number]{
  return kind==="conveyor"?[BELT.width,BELT.length]:kind==="scanner"?[SCAN_TUNNEL.width,SCAN_TUNNEL.length]:kind==="pallet"?[STREAM_CONFIG.palletWidth,STREAM_CONFIG.palletDepth]:kind==="dock"?F.amr:kind==="rack"?RACK_CONFIG.footprint:kind==="amr"?F.amr:F.robot;
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
  const hw=STREAM_CONFIG.palletWidth/2,hd=STREAM_CONFIG.palletDepth/2;
  for(const x of [-hw,hw])for(const z of [-hd,hd]){
    const px=pallet.x+x*Math.cos(pallet.yaw)+z*Math.sin(pallet.yaw),pz=pallet.z-x*Math.sin(pallet.yaw)+z*Math.cos(pallet.yaw);
    if(!reach(px,pz)&&!errors.some(e=>e.includes("팔레트 적재")))errors.push("팔레트 적재 지점이 로봇 도달 범위 밖입니다.");
  }
  if(clearanceAt(robot.x,robot.z,"conveyor",layout)<F.robotRadius)errors.push("로봇 베이스와 컨베이어가 겹칩니다.");
  if(clearanceAt(robot.x,robot.z,"pallet",layout)<F.robotRadius)errors.push("로봇 베이스와 팔레트가 겹칩니다.");
  if(clearanceAt(pallet.x,pallet.z,"conveyor",layout)<AMR_TRAFFIC.loadedRadius)errors.push("팔레트와 컨베이어 사이를 벌려 주세요.");
  if(clearanceAt(layout.amr.x,layout.amr.z,"robot",layout)<AMR_TRAFFIC.emptyRadius||clearanceAt(layout.amr.x,layout.amr.z,"conveyor",layout)<AMR_TRAFFIC.emptyRadius)errors.push("AMR 시작 위치가 다른 설비와 겹칩니다.");
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
/** Room wall piece (kind "floor", 2-point path, radius = half thickness): blocks the AMR body circle, and when loaded
 * also the carried pallet as its real square at the planner's pallet yaw (separating axes), not the loaded envelope,
 * so docks set against a wall stay reachable while the pallet still never clips the wall. */
function wallBlocker(o:NavigationObstacle,loaded:boolean,palletYaw:number):(x:number,z:number)=>boolean{
  const a=o.path![0],b=o.path![o.path!.length-1],r=o.radius??0,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)||1e-9;
  const ux=dx/length,uz=dz/length,cx=(a.x+b.x)/2,cz=(a.z+b.z)/2,limit=AMR_TRAFFIC.emptyRadius-1e-8;
  const body=(x:number,z:number)=>{const t=Math.max(0,Math.min(length,(x-a.x)*ux+(z-a.z)*uz));return Math.hypot(x-a.x-t*ux,z-a.z-t*uz)-r<limit;};
  if(!loaded)return body;
  const [pw,pd]=footprint("pallet"),pc=Math.cos(palletYaw),ps=Math.sin(palletYaw);
  const axes=[[pc,-ps],[ps,pc],[ux,uz],[-uz,ux]].map(([nx,nz])=>[nx,nz,pw/2*Math.abs(nx*pc-nz*ps)+pd/2*Math.abs(nx*ps+nz*pc)+length/2*Math.abs(nx*ux+nz*uz)+r*Math.abs(-nx*uz+nz*ux)+.01-1e-8]);
  return (x,z)=>{if(body(x,z))return true;for(const [nx,nz,gap] of axes)if(Math.abs((x-cx)*nx+(z-cz)*nz)>=gap)return false;return true;};
}
function navigationClear(layout:FactoryLayout,x:number,z:number,loaded:boolean,extra:NavigationObstacle[]){
  const radius=loaded?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius;
  const clears=(kind:EquipmentKind,pose:EquipmentPose&{conveyorTurn?:ConveyorTurn})=>loaded&&!(kind==="conveyor"&&pose.conveyorTurn&&pose.conveyorTurn!=="straight")?!loadedOverlaps(x,z,layout.pallet.yaw,kind,pose)&&clearancePose(x,z,kind,pose)>=AMR_TRAFFIC.emptyRadius-1e-8:clearancePose(x,z,kind,pose)>=radius-1e-8;
  return clears("robot",layout.robot)&&clears("conveyor",layout.conveyor)&&!extra.some(o=>o.kind==="floor"&&o.path?.length?wallBlocker(o,loaded,layout.pallet.yaw)(x,z):o.radius!==undefined||o.path?.length?obstacleClearance(x,z,o)<radius-1e-8:!clears(o.kind,o.pose));
}
/** Same result as navigationClear, but each point only tests obstacles whose conservative bound can reach it
 * (bucketed on a 1 m grid, then a tight bounding-box check). Pose tests reuse precomputed trig/extents, and
 * reserved paths are split per segment so a sample only measures the segments near it. Grid builds and segment
 * checks used to test every obstacle (and every point of every reserved path) per sample. */
function preparedClear(layout:FactoryLayout,loaded:boolean,extra:NavigationObstacle[]):(x:number,z:number)=>boolean{
  const radius=loaded?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius,size=1,limit=radius-1e-8,margin=.02;
  const [pw,pd]=footprint("pallet"),palletHalf=Math.hypot(pw,pd)/2;
  type Entry={minX:number;maxX:number;minZ:number;maxZ:number;blocks:(x:number,z:number)=>boolean};
  const buckets=new Map<number,Entry[]>();
  const key=(cx:number,cz:number)=>cx*65536+cz;
  // reach: the farthest a blocked point can be from the box [minX,maxX]x[minZ,maxZ] (exact bound, plus a small margin).
  const add=(minX:number,maxX:number,minZ:number,maxZ:number,reach:number,blocks:(x:number,z:number)=>boolean)=>{
    const entry:Entry={minX:minX-reach-margin,maxX:maxX+reach+margin,minZ:minZ-reach-margin,maxZ:maxZ+reach+margin,blocks};
    for(let cx=Math.floor(entry.minX/size);cx<=Math.floor(entry.maxX/size);cx++)for(let cz=Math.floor(entry.minZ/size);cz<=Math.floor(entry.maxZ/size);cz++){
      const k=key(cx,cz);let list=buckets.get(k);if(!list){list=[];buckets.set(k,list);}list.push(entry);
    }
  };
  const addPose=(kind:EquipmentKind,pose:EquipmentPose&{conveyorTurn?:ConveyorTurn})=>{
    const turned=kind==="conveyor"&&!!pose.conveyorTurn&&pose.conveyorTurn!=="straight";
    const [width,depth]=footprint(kind),half=turned?2*BELT.radius+BELT.width:Math.hypot(width,depth)/2;
    const px=pose.x,pz=pose.z;
    let blocks:(x:number,z:number)=>boolean;
    if(turned)blocks=(x,z)=>clearancePose(x,z,kind,pose)<limit;
    else if(loaded){
      // loadedOverlaps with the separating-axis extents precomputed (same expressions, same results).
      const yaw=layout.pallet.yaw,ac=Math.cos(yaw),as=Math.sin(yaw),bc=Math.cos(pose.yaw),bs=Math.sin(pose.yaw);
      const axes=[[ac,-as],[as,ac],[bc,-bs],[bs,bc]].map(([nx,nz])=>{
        const a=pw/2*Math.abs(nx*ac-nz*as)+pd/2*Math.abs(nx*as+nz*ac);
        const b=width/2*Math.abs(nx*bc-nz*bs)+depth/2*Math.abs(nx*bs+nz*bc);
        return [nx,nz,a+b+.01-1e-8];
      });
      // The AMR body (emptyRadius circle) is larger than the pallet it carries, so it must clear too.
      const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw),body=AMR_TRAFFIC.emptyRadius-1e-8;
      blocks=(x,z)=>{
        const dx=x-px,dz=z-pz;
        if(Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-width/2),Math.max(0,Math.abs(dx*s+dz*c)-depth/2))<body)return true;
        for(const [nx,nz,gap] of axes)if(Math.abs(dx*nx+dz*nz)>=gap)return false;return true;
      };
    }else{
      // clearancePose for a straight footprint with its trig precomputed.
      const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
      blocks=(x,z)=>{
        const dx=x-px,dz=z-pz;
        return Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-width/2),Math.max(0,Math.abs(dx*s+dz*c)-depth/2))<limit;
      };
    }
    add(px,px,pz,pz,(loaded&&!turned?Math.max(palletHalf+.01,AMR_TRAFFIC.emptyRadius):radius)+half,blocks);
  };
  addPose("robot",layout.robot);addPose("conveyor",layout.conveyor);
  for(const o of extra){
    if(o.kind==="floor"&&o.path?.length){
      const a=o.path[0],b=o.path[o.path.length-1],reach=(o.radius??0)+(loaded?palletHalf+.01:radius);
      add(Math.min(a.x,b.x),Math.max(a.x,b.x),Math.min(a.z,b.z),Math.max(a.z,b.z),Math.max(reach,(o.radius??0)+AMR_TRAFFIC.emptyRadius),wallBlocker(o,loaded,layout.pallet.yaw));
    }else if(o.path?.length){
      // obstacleClearance takes the minimum over segments, so the path blocks exactly when one segment does.
      const path=o.path,r=o.radius??0;
      for(let i=0;i<path.length;i++){
        const a=path[i],b=path[Math.min(i+1,path.length-1)],ax=a.x,az=a.z,dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
        add(Math.min(a.x,b.x),Math.max(a.x,b.x),Math.min(a.z,b.z),Math.max(a.z,b.z),r+radius,(x,z)=>{
          const t=length?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/length)):0;
          return Math.max(0,Math.hypot(x-ax-t*dx,z-az-t*dz)-r)<limit;
        });
      }
    }else if(o.radius!==undefined){
      const ox=o.pose.x,oz=o.pose.z,r=o.radius;
      add(ox,ox,oz,oz,r+radius,(x,z)=>Math.max(0,Math.hypot(x-ox,z-oz)-r)<limit);
    }else addPose(o.kind,o.pose);
  }
  return (x,z)=>{
    const list=buckets.get(key(Math.floor(x/size),Math.floor(z/size)));
    if(list)for(const e of list)if(x>=e.minX&&x<=e.maxX&&z>=e.minZ&&z<=e.maxZ&&e.blocks(x,z))return false;
    return true;
  };
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
  const blocked=(point:{x:number;z:number})=>!navigationClear(layout,point.x,point.z,loaded,extra.filter(o=>!o.path?.length||o.kind==="floor"));
  if(blocked(start))return `${stage}: 출발 공간이 부족합니다. 주변 장비 간격을 확인해 주세요.`;
  if(blocked(goal))return `${stage}: 도착 공간이 부족합니다. 주변 장비 간격을 확인해 주세요.`;
  if(extra.some(o=>o.path?.length&&o.kind!=="floor"))return `${stage}: 다른 AMR의 운반·복귀 경로 예약이 해제되기를 기다립니다.`;
  return `${stage}: 연결 가능한 통로가 없습니다. 장비 배치를 확인해 주세요.`;
}
export function layoutPath(layout:FactoryLayout,start:{x:number;z:number},goal:{x:number;z:number},loaded:boolean,extra:NavigationObstacle[]=[]):Vector3[]|null{
  const radius=loaded?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius,padding=C.navigationPadding;
  const clear=preparedClear(layout,loaded,extra);
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
      // Room walls never grow the region (a wall spans the room); they still block every sample through preparedClear.
      if(included.has(obstacle)||obstacle.kind==="floor")continue;
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
  // Cells are classified lazily (0 unknown, 1 blocked, 2 clear): A* on a factory-wide region only touches a
  // fraction of the grid, and testing every cell up front cost tens of ms per route. Same test, same results.
  const state=new Uint8Array(columns*rows);
  const blocked={has:(id:number)=>{
    let s=state[id];
    if(!s){const x=id%columns,z=(id-x)/columns;s=state[id]=clear(x*C.grid+minX,z*C.grid+minZ)?2:1;}
    return s===1;
  }};
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
  // Edge memo per cell and neighbour direction (0 unknown, 1 blocked, 2 clear), stored for both ends.
  const edges=new Uint8Array(columns*rows*9);
  const canTraverse=(a:Cell,b:Cell)=>{
    const d=(b[0]-a[0]+1)*3+(b[1]-a[1]+1),ai=(a[1]*columns+a[0])*9+d;
    let s=edges[ai];
    if(!s){s=segmentClear(world(a),world(b))?2:1;edges[ai]=s;edges[(b[1]*columns+b[0])*9+8-d]=s;}
    return s===2;
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
