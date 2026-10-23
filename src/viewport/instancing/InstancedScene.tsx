import { clickBox, clickEquipment, inspectEquipment, playHover } from "@/viewport/selection/inspectEquipment";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { cargoBoxId, sceneOwner } from "@/viewport/scene/sceneOwner";
import { useCargoStore } from "@/stores/useCargoStore";
import { Vector2 } from "three";
import { SelectionOutline } from "@/viewport/selection/SelectionOutline";
import { LINK_ACTIVE_COLOR } from "@/viewport/editor/links/linkPoints";
import { SceneInstances } from "@/viewport/instancing/SceneInstances";
import { selectedIds, useSceneStore } from "@/stores/useSceneStore";
import { InstanceContext } from "@/viewport/instancing/useInstanceModel";
import { INSTANCE_SYNC_PRIORITY } from "@/constants/viewport";
import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";
function InstanceRenderer({instances}:{instances:SceneInstances}){
  const outline=useMemo(()=>new SelectionOutline(),[]),resolution=useMemo(()=>new Vector2(),[]);
  // Orange outline on equipment linked to the selection; re-derived from scene.links every frame so it follows link edits live.
  const linkedOutline=useMemo(()=>new SelectionOutline(LINK_ACTIVE_COLOR),[]);
  useEffect(()=>()=>{outline.dispose();linkedOutline.dispose();},[outline,linkedOutline]);
  // Only synchronize here. EffectComposer owns rendering, including the stencil outline.
  useFrame(state=>{const t0=profileStart();instances.sync();profileEnd("instances",t0);const t1=profileStart();const box=useCargoStore.getState().selectedBoxId;const scene=useSceneStore.getState();const ids=box?[box]:selectedIds(scene).filter(id=>!id.startsWith("floor-"));state.gl.getDrawingBufferSize(resolution);outline.sync(instances,ids,resolution);linkedOutline.sync(instances,box?[]:linkedIds(scene.links,ids),resolution);profileEnd("outline",t1);},INSTANCE_SYNC_PRIORITY);
  return <><primitive object={outline.root} dispose={null}/><primitive object={linkedOutline.root} dispose={null}/><primitive object={instances.root} dispose={null} {...playHover} onClick={(event:ThreeEvent<MouseEvent>)=>{
    const owner=event.object.userData.instanceOwners?.[event.instanceId??-1]??null,box=cargoBoxId(owner);
    if(box){clickBox(event,box);return;}
    const id=sceneOwner(owner);
    // Edit mode: select (not while placing); Play mode: open Details. Resolves instanceId to the owner.
    if(id)clickEquipment(event,id);
  }} onDoubleClick={(event:ThreeEvent<MouseEvent>)=>{
    const id=sceneOwner(event.object.userData.instanceOwners?.[event.instanceId??-1]??null);
    if(id)inspectEquipment(event,id);
  }}/></>;
}
/** Ids linked (either direction) to any of `ids`, excluding `ids` themselves; sorted so the outline key is stable. */
function linkedIds(links:readonly {from:string;to:string}[],ids:readonly string[]):string[]{
  if(!ids.length||!links.length)return [];
  const selected=new Set(ids),linked=new Set<string>();
  for(const link of links){
    if(selected.has(link.from)&&!selected.has(link.to))linked.add(link.to);
    else if(selected.has(link.to)&&!selected.has(link.from))linked.add(link.from);
  }
  return [...linked].sort();
}
export default function InstancedScene({children}:{children:ReactNode}){
  const instances=useMemo(()=>new SceneInstances(),[]);
  useEffect(()=>()=>instances.dispose(),[instances]);
  return <InstanceContext.Provider value={instances}>{children}<InstanceRenderer instances={instances}/></InstanceContext.Provider>;
}
