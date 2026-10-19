import { create } from "zustand";
import type { EquipmentKind,EquipmentPose,SceneEquipment,EquipmentSettings,ConveyorTurn } from "../types/layout";
import { DEFAULT_LAYOUT,SIMULATOR_CONFIG as C,EDITOR_HISTORY_LIMIT } from "../constants/simulatorLayout";
import { useSimulationStore } from "./useSimulationStore";
import { validateScene } from "../utils/amr/sceneValidation";
import { beltConnections,connectedBeltIds,extendBelt,snapBelt } from "@/utils/conveyor/conveyorLayout";
import { SCENE_TEMPLATES } from "@/constants/sceneTemplates";
import type { SceneTemplate } from "@/types/sceneTemplate";

export const EQUIPMENT_NAMES:Record<EquipmentKind,string>={robot:"로봇",pallet:"팔레트",conveyor:"컨베이어",amr:"AMR",dock:"출고 구역",scanner:"스캐너"};
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
  loadTemplate: (template: SceneTemplate) => boolean;
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
  select:selected=>{if(get().selected!==selected||get().inspected!==null)set({selected,inspected:null});},setPending:pending=>{if(get().pending!==pending)set({pending});},setTool:tool=>{if(get().tool!==tool)set({tool});},
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
    const state = get(), current = state.settings[id];
    if (!current) return;
    if (values.defectRate !== undefined && (!Number.isFinite(values.defectRate) || values.defectRate < 0 || values.defectRate > 1)) return;
    const connected = values.speed !== undefined && state.objects.some(object => object.id === id && object.kind === "conveyor")
      ? connectedBeltIds(state.objects, id) : new Set([id]);
    const nextSettings = { ...state.settings };
    let changed = false;
    for (const target of connected) {
      const config = state.settings[target];
      if (!config) continue;
      const updates = target === id ? values : { speed: values.speed };
      if (Object.entries(updates).every(([key, value]) => config[key as keyof EquipmentSettings] === value)) continue;
      nextSettings[target] = { ...config, ...updates };
      changed = true;
    }
    if (!changed) return;
    set({ ...history(state), settings: nextSettings, errors: [] });
    if(!get().editing&&values.capacity!==undefined)useSimulationStore.getState().reset();
  },
  remove:id=>{if(!get().editing||!get().settings[id])return;set(state=>{const next={...state.settings};delete next[id];return {...history(state),objects:state.objects.filter(object=>object.id!==id),settings:next,selected:state.selected===id?null:state.selected,errors:[]};});},
  edit:()=>{if(get().editing)return;useSimulationStore.getState().reset();set({editing:true,errors:[],inspected:null});},
  complete:()=>{const state=get(),errors=validateScene(state.objects,state.settings);if(!errors.length)useSimulationStore.getState().reset();set({errors,editing:errors.length>0,pending:null,inspected:null});},
  clear:()=>{if(!get().editing)useSimulationStore.getState().reset();set({...history(get()),objects:[],settings:{},selected:null,pending:null,editing:true,errors:[]});},
  loadTemplate: (template) => {
    const state = get();
    if (!state.editing) return false;
    const objects = template.equipment.map((entry, index) => ({
      kind: entry.kind, x: entry.x, z: entry.z, yaw: entry.yaw, conveyorTurn: entry.conveyorTurn,
      id: `${entry.kind}-${index + 1}`, name: `${EQUIPMENT_NAMES[entry.kind]} ${index + 1}`,
    }));
    const configs = Object.fromEntries(objects.map((object, index) => [
      object.id, { ...settings(), ...template.equipment[index].settings },
    ]));
    const errors = validateScene(objects, configs);
    if (errors.length) { set({ errors }); return false; }
    set({ ...history(state), objects, settings: configs, selected: null, inspected: null,
      pending: null, errors: [], nextId: objects.length + 1 });
    return true;
  },
  example:()=>{
    if (!get().editing) get().edit();
    get().loadTemplate(SCENE_TEMPLATES[1]);
    get().select(get().objects[0]?.id ?? null);
  },
}));
