import { createContext, useContext, useEffect } from "react";
import type { Object3D } from "three";
import type { SceneInstances } from "@/viewport/instancing/SceneInstances";

export const InstanceContext=createContext<SceneInstances|null>(null);
export const useSceneInstances=()=>useContext(InstanceContext);
/** `staticShadow`: a static model whose shadows are baked in its textures (no cast, no receive). */
export function useInstanceModel(object:Object3D,staticShadow=false){
  const instances=useSceneInstances();
  useEffect(()=>instances?.register(object,staticShadow),[instances,object,staticShadow]);
}
