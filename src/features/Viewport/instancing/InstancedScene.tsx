import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Object3D } from "three";
import { SceneInstances } from "@/features/Viewport/instancing/SceneInstances";
import { useSceneStore } from "@/stores/useSceneStore";
import { InstanceContext } from "@/features/Viewport/instancing/useInstanceModel";
function InstanceRenderer({instances}:{instances:SceneInstances}){
  // Run after every robot/AMR update so attached cargo uses this frame's joint transforms.
  useFrame(state=>{instances.sync();state.gl.render(state.scene,state.camera);},1);
  return <primitive object={instances.root} dispose={null} onPointerDown={(event:{stopPropagation:()=>void;object:Object3D;instanceId?:number})=>{
    if(useSceneStore.getState().pending)return;
    let object:Object3D|null=event.object.userData.instanceOwners?.[event.instanceId??-1]??null;
    while(object&&!object.userData.sceneId)object=object.parent;
    if(object){event.stopPropagation();useSceneStore.getState().select(object.userData.sceneId);}
  }}/>;
}
export default function InstancedScene({children}:{children:ReactNode}){
  const instances=useMemo(()=>new SceneInstances(),[]);
  useEffect(()=>()=>instances.dispose(),[instances]);
  return <InstanceContext.Provider value={instances}>{children}<InstanceRenderer instances={instances}/></InstanceContext.Provider>;
}
