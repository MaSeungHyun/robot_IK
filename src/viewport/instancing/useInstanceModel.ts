import { createContext, useContext, useEffect } from "react";
import type { Object3D } from "three";
import type { SceneInstances } from "@/viewport/instancing/SceneInstances";

export const InstanceContext=createContext<SceneInstances|null>(null);
export const useSceneInstances=()=>useContext(InstanceContext);
export function useInstanceModel(object:Object3D){
  const instances=useSceneInstances();
  useEffect(()=>instances?.register(object),[instances,object]);
}
