import { clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Object3D } from "three";
import { Vector2 } from "three";
import { SelectionOutline } from "@/viewport/selection/SelectionOutline";
import { SceneInstances } from "@/viewport/instancing/SceneInstances";
import { useSceneStore } from "@/stores/useSceneStore";
import { InstanceContext } from "@/viewport/instancing/useInstanceModel";
function InstanceRenderer({instances}:{instances:SceneInstances}){
  const outline=useMemo(()=>new SelectionOutline(),[]),resolution=useMemo(()=>new Vector2(),[]);
  useEffect(()=>()=>outline.dispose(),[outline]);
  // Run after every robot/AMR update so attached cargo uses this frame's joint transforms.
  useFrame(state=>{instances.sync();outline.sync(instances,useSceneStore.getState().selected,state.gl.getDrawingBufferSize(resolution));state.gl.render(state.scene,state.camera);},1);
  return <><primitive object={outline.root} dispose={null}/><primitive object={instances.root} dispose={null} {...playHover} onClick={(event:ThreeEvent<MouseEvent>)=>{
    let object:Object3D|null=event.object.userData.instanceOwners?.[event.instanceId??-1]??null;
    while(object&&!object.userData.sceneId)object=object.parent;
    // Edit mode: select (not while placing); Play mode: open Details. Resolves instanceId to the owner.
    if(object)clickEquipment(event,object.userData.sceneId);
  }} onDoubleClick={(event:ThreeEvent<MouseEvent>)=>{
    let object:Object3D|null=event.object.userData.instanceOwners?.[event.instanceId??-1]??null;
    while(object&&!object.userData.sceneId)object=object.parent;
    if(object)inspectEquipment(event,object.userData.sceneId);
  }}/></>;
}
export default function InstancedScene({children}:{children:ReactNode}){
  const instances=useMemo(()=>new SceneInstances(),[]);
  useEffect(()=>()=>instances.dispose(),[instances]);
  return <InstanceContext.Provider value={instances}>{children}<InstanceRenderer instances={instances}/></InstanceContext.Provider>;
}
