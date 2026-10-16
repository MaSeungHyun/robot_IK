import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo,Suspense,useEffect,useMemo,useRef } from "react";
import { BufferGeometry,Line as ThreeLine,LineBasicMaterial,Vector3 } from "three";
import type { Object3D } from "three";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { FactorySimulator } from "@/features/customize/FactorySimulator";
import type { FactoryRobot,FactoryAgent } from "@/features/customize/FactorySimulator";
import Equipment,{Belt,PalletPreview,RobotPreview,Dock} from "@/features/customize/Equipment";
import PlacementFloor from "@/features/customize/PlacementFloor";
import InstancedScene from "@/features/Viewport/instancing/InstancedScene";
import {useSceneInstances} from "@/features/Viewport/instancing/useInstanceModel";
import Robot from "@/features/Viewport/models/Robot";
import AMR from "@/features/Viewport/models/AMR";
import type { EquipmentSettings } from "@/types/layout";
import type { RobotTransferMode } from "@/types/robot";
import type { StreamStats } from "@/types/conveyor";
import { simulationDelta } from "@/utils/simulation/simulationTime";
import { CUSTOMIZE_CONFIG as C } from "@/constants/customize";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";

type Props={running:boolean;transferMode:RobotTransferMode;onStats:(stats:StreamStats)=>void;onProgress:(count:number,status:string)=>void};
const getSettings=()=>useSceneStore.getState().settings;
const FactoryArm=memo(function FactoryArm({robot,world,running,transferMode,settings}:{robot:FactoryRobot;world:FactorySimulator;running:boolean;transferMode:RobotTransferMode;settings:EquipmentSettings}){
  const jobs=useRef(robot.jobs);
  return <Robot robotId={robot.object.id} position={[robot.object.x,0,robot.object.z]} rotation={[0,robot.object.yaw,0]} geometryScale={C.robotScale} pickupRadius={C.reach} transferMode={transferMode}
    simulationSpeed={settings.speed} jobs={jobs} running={running&&settings.enabled} onProgress={(count,status)=>world.robotProgress(robot,count,status)}
    onPointerDown={event=>{event.stopPropagation();useSceneStore.getState().select(robot.object.id);}}/>;
});
function AgentRoute({agent}:{agent:FactoryAgent}){
  const line=useMemo(()=>new ThreeLine(new BufferGeometry(),new LineBasicMaterial({color:0x38bdf8})),[]),ref=useRef(line),version=useRef(-1);
  useEffect(()=>()=>{line.geometry.dispose();line.material.dispose();},[line]);
  useFrame(()=>{if(version.current===agent.dispatch.version)return;version.current=agent.dispatch.version;
    const object=ref.current;object.geometry.dispose();object.geometry=new BufferGeometry().setFromPoints(agent.dispatch.path.map(p=>new Vector3(p.x,.025,p.z)));object.visible=agent.dispatch.path.length>1;
  });
  return <primitive object={line}/>;
}
function FactoryRun({running,transferMode,onStats,onProgress}:Props){
  const speed=useSimulationStore(state=>state.speed);
  const setEquipment=useSimulationStore(state=>state.setEquipment);
  const instances=useSceneInstances();
  const {objects,settings}=useSceneStore(useShallow(s=>({objects:s.objects,settings:s.settings})));
  const box=useGLTF(boxUrl),pallet=useGLTF(palletUrl);
  const world=useMemo(()=>new FactorySimulator(objects,box.scene,pallet.scene,getSettings,instances??undefined),[objects,box.scene,pallet.scene,instances]);
  useEffect(()=>{world.connectInstances();return()=>world.dispose();},[world]);
  const report=useRef(0);
  useEffect(()=>{onStats(world.stats);onProgress(0,world.status);setEquipment(world.equipment);return()=>setEquipment(null);},[world,onStats,onProgress,setEquipment]);
  useFrame((_,delta)=>{if(!running)return;const dt=simulationDelta(delta,speed);world.advance(dt);report.current+=Math.min(delta,.25);
    if(report.current>=.25){report.current=0;onStats(world.stats);onProgress(world.placed,world.status);setEquipment(world.equipment);}
  },-2);
  return <>
    <primitive object={world.root} onPointerDown={(event:{stopPropagation:()=>void;object:Object3D})=>{
      let node:Object3D|null=event.object;while(node&&!node.userData.sceneId)node=node.parent;
      if(node){event.stopPropagation();useSceneStore.getState().select(node.userData.sceneId);}
    }}/>
    {world.robots.map(robot=><FactoryArm key={robot.object.id} robot={robot} world={world} running={running} transferMode={transferMode} settings={settings[robot.object.id]}/>)}
    {world.robots.map(robot=><mesh key={`range-${robot.object.id}`} position={[robot.object.x,.005,robot.object.z]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[settings[robot.object.id].reach-.008,settings[robot.object.id].reach,80]}/><meshBasicMaterial color="#38bdf8" transparent opacity={.25}/></mesh>)}
    {world.agents.map(agent=><group key={agent.object.id}>
      <primitive object={agent.dispatch.carrier} onPointerDown={(event:{stopPropagation:()=>void})=>{event.stopPropagation();useSceneStore.getState().select(agent.object.id);}}><AMR/></primitive>
      <AgentRoute agent={agent}/>
    </group>)}
    {objects.filter(o=>o.kind==="conveyor"||o.kind==="dock").map(object=><group key={object.id} userData={{sceneId:object.id}} position={[object.x,0,object.z]} rotation={[0,object.yaw,0]} onPointerDown={event=>{event.stopPropagation();useSceneStore.getState().select(object.id);}}>{object.kind==="conveyor"?<Belt entity={object}/>:<Dock/>}</group>)}
  </>;
}
const EditableObject=memo(function EditableObject({id}:{id:string}){
  const object=useSceneStore(state=>state.objects.find(object=>object.id===id));
  const reach=useSceneStore(state=>state.settings[id]?.reach??C.reach);
  if(!object)return null;
  return <>
    <Equipment entity={object}>
      {object.kind==="robot"?<RobotPreview/>:object.kind==="pallet"?<PalletPreview/>:object.kind==="conveyor"?<Belt entity={object}/>:object.kind==="amr"?<AMR/>:<Dock/>}
      {object.kind==="robot"&&<mesh position={[0,.005,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[reach-.01,reach,80]}/><meshBasicMaterial color="#38bdf8" transparent opacity={.4}/></mesh>}
    </Equipment>
  </>;
});
function SceneEditor(){
  const ids=useSceneStore(useShallow(state=>state.objects.map(object=>object.id)));
  return <>
    <PlacementFloor/>
    {ids.map(id=><Suspense key={id} fallback={null}><EditableObject id={id}/></Suspense>)}
  </>;
}
export default function CustomizeDemo({simulationRun,...props}:Props&{simulationRun:number}){
  const editing=useSceneStore(state=>state.editing);
  return <InstancedScene>{editing?<SceneEditor/>:<FactoryRun key={simulationRun} {...props}/>}</InstancedScene>;
}
