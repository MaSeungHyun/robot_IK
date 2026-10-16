import { create } from "zustand";
import type { EquipmentKind,EquipmentPose,SceneEquipment,EquipmentSettings,ConveyorTurn } from "../types/layout";
import { DEFAULT_LAYOUT,CUSTOMIZE_CONFIG as C,EDITOR_HISTORY_LIMIT } from "../constants/customize";
import { useSimulationStore } from "./useSimulationStore";
import { validateScene } from "../utils/amr/sceneValidation";
import { beltConnections,extendBelt,snapBelt } from "@/utils/conveyor/conveyorLayout";

export const EQUIPMENT_NAMES:Record<EquipmentKind,string>={robot:"로봇",pallet:"팔레트",conveyor:"컨베이어",amr:"AMR",dock:"출고 구역"};
const settings=():EquipmentSettings=>({speed:1,reach:C.reach,capacity:20,spawnInterval:8,enabled:true});
interface SceneState{
  inspected:string|null;inspect:(id:string|null)=>void;
  past:SceneSnapshot[];future:SceneSnapshot[];undo:()=>void;redo:()=>void;
  objects:SceneEquipment[];settings:Record<string,EquipmentSettings>;selected:string|null;pending:EquipmentKind|null;editing:boolean;tool:"translate"|"rotate";errors:string[];nextId:number;
  select:(id:string|null)=>void;setPending:(kind:EquipmentKind|null)=>void;setTool:(tool:"translate"|"rotate")=>void;
  add:(kind:EquipmentKind,pose:Partial<EquipmentPose>)=>void;updatePose:(id:string,pose:Partial<EquipmentPose>)=>void;
  extendConveyor:(id:string,turn:ConveyorTurn)=>void;
  updateSettings:(id:string,values:Partial<EquipmentSettings>)=>void;remove:(id:string)=>void;
  edit:()=>void;complete:()=>void;clear:()=>void;example:()=>void;
}
type SceneSnapshot=Pick<SceneState,"objects"|"settings"|"selected"|"nextId">;
const snapshot=(state:SceneState):SceneSnapshot=>({objects:state.objects,settings:state.settings,selected:state.selected,nextId:state.nextId});
const history=(state:SceneState)=>state.editing?{past:[...state.past,snapshot(state)].slice(-EDITOR_HISTORY_LIMIT),future:[]}:{};
export const useSceneStore=create<SceneState>((set,get)=>({
  past:[],future:[],
  inspected:null,inspect:id=>set(id?{inspected:id,selected:id}:{inspected:null}),
  undo:()=>{const state=get();if(!state.editing||!state.past.length)return;set({...state.past[state.past.length-1],past:state.past.slice(0,-1),future:[snapshot(state),...state.future],pending:null,errors:[]});},
  redo:()=>{const state=get();if(!state.editing||!state.future.length)return;set({...state.future[0],past:[...state.past,snapshot(state)].slice(-EDITOR_HISTORY_LIMIT),future:state.future.slice(1),pending:null,errors:[]});},
  objects:[],settings:{},selected:null,pending:null,editing:true,tool:"translate",errors:[],nextId:1,
  select:selected=>{if(get().selected!==selected||(!get().editing&&get().inspected!==selected))set({selected,inspected:get().editing?null:selected});},setPending:pending=>{if(get().pending!==pending)set({pending});},setTool:tool=>{if(get().tool!==tool)set({tool});},
  add:(kind,pose)=>{
    if(!get().editing)return;
    set(state=>{
      const id=`${kind}-${state.nextId}`,initial={...DEFAULT_LAYOUT[kind],...pose,id,kind,name:`${EQUIPMENT_NAMES[kind]} ${state.nextId}`},object=kind==="conveyor"?snapBelt(initial,state.objects):initial;
      return {...history(state),objects:[...state.objects,object],settings:{...state.settings,[id]:settings()},selected:id,pending:null,nextId:state.nextId+1,errors:[]};
    });
  },
  extendConveyor:(id,turn)=>{
    const state=get(),source=state.objects.find(o=>o.id===id&&o.kind==="conveyor");
    if(!state.editing||!source||beltConnections(state.objects).next.has(id))return;
    const pose=extendBelt(source,turn);
    const nextId=`conveyor-${state.nextId}`,object={...pose,id:nextId,kind:"conveyor" as const,name:`컨베이어 ${state.nextId}`};
    set({...history(state),objects:[...state.objects,object],settings:{...state.settings,[nextId]:{...state.settings[id]}},selected:nextId,pending:null,nextId:state.nextId+1,errors:[]});
  },
  updatePose:(id,pose)=>{
    if(!get().editing)return;
    const object=get().objects.find(object=>object.id===id);
    if(!object||Object.entries(pose).every(([key,value])=>Math.abs(object[key as keyof EquipmentPose]-value)<1e-8))return;
    const changed={...object,...pose},next=object.kind==="conveyor"?snapBelt(changed,get().objects):changed;
    set(state=>({...history(state),objects:state.objects.map(object=>object.id===id?next:object),errors:[]}));
  },
  updateSettings:(id,values)=>{
    const current=get().settings[id];
    if(!current||Object.entries(values).every(([key,value])=>current[key as keyof EquipmentSettings]===value))return;
    set(state=>({...history(state),settings:{...state.settings,[id]:{...state.settings[id],...values}},errors:[]}));
    if(!get().editing&&values.capacity!==undefined)useSimulationStore.getState().reset();
  },
  remove:id=>{if(!get().editing||!get().settings[id])return;set(state=>{const next={...state.settings};delete next[id];return {...history(state),objects:state.objects.filter(object=>object.id!==id),settings:next,selected:state.selected===id?null:state.selected,errors:[]};});},
  edit:()=>{if(get().editing)return;useSimulationStore.getState().reset();set({editing:true,errors:[],inspected:null});},
  complete:()=>{const state=get(),errors=validateScene(state.objects,state.settings);if(!errors.length)useSimulationStore.getState().reset();set({errors,editing:errors.length>0,pending:null,inspected:null});},
  clear:()=>{if(!get().editing)useSimulationStore.getState().reset();set({...history(get()),objects:[],settings:{},selected:null,pending:null,editing:true,errors:[]});},
  example:()=>{
    if(!get().editing)useSimulationStore.getState().reset();
    const poses:({kind:EquipmentKind}&EquipmentPose)[]=[
      {kind:"robot",x:0,z:-.85,yaw:0},{kind:"robot",x:0,z:.85,yaw:Math.PI/6},
      {kind:"pallet",x:-1.15,z:-.85,yaw:0},{kind:"pallet",x:-1.15,z:.85,yaw:0},
      {kind:"conveyor",...DEFAULT_LAYOUT.conveyor},{kind:"amr",x:-3,z:-2,yaw:0},{kind:"dock",x:-3,z:2,yaw:0},
    ];
    const objects=poses.map((pose,index)=>({...pose,id:`${pose.kind}-${index+1}`,name:`${EQUIPMENT_NAMES[pose.kind]} ${index+1}`}));
    set({...history(get()),objects,settings:Object.fromEntries(objects.map(object=>[object.id,settings()])),selected:objects[0].id,pending:null,editing:true,errors:[],nextId:objects.length+1});
  },
}));
