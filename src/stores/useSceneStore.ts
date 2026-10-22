import { create } from "zustand";
import type { EquipmentKind,EquipmentPose,SceneEquipment,EquipmentSettings,ConveyorTurn,FloorSize } from "../types/layout";
import { DEFAULT_LAYOUT,SIMULATOR_CONFIG as C,EDITOR_HISTORY_LIMIT,FLOOR_CONFIG } from "../constants/simulatorLayout";
import { useSimulationStore } from "./useSimulationStore";
import { validateScene } from "@/domain/amr/navigation/sceneValidation";
import { beltConnections,connectedBeltIds,extendBelt,snapBelt } from "@/domain/conveyor/conveyorLayout";
import { SCENE_TEMPLATES } from "@/constants/sceneTemplates";
import type { SceneTemplate } from "@/types/sceneTemplate";
import { migrateSettings, unrealisticWarning } from "@/domain/simulation/equipmentSpeeds";
import { log } from "@/stores/useLogStore";
import { LINK_RULES, linkTypeFor, type SceneLink } from "@/types/links";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { DOOR_CONFIG } from "@/constants/door";
import { snapDoorToWall } from "@/domain/room/roomWalls";

/** select: pick only (no gizmo); translate/rotate: gizmo mode on the selection. */
export type EditorTool="select"|"translate"|"rotate";
/** All selected ids (multi-select), primary/active (`selected`) last. Falls back to `selected` alone when `selection` is stale. */
export function selectedIds(state:{objects:SceneEquipment[];selected:string|null;selection:string[]}):string[]{
  if(!state.selected)return [];
  const ids=state.selection.includes(state.selected)?state.selection.filter(id=>id!==state.selected&&state.objects.some(o=>o.id===id)):[];
  return [...ids,state.selected];
}
export const EQUIPMENT_NAMES:Record<EquipmentKind,string>={robot:"로봇",pallet:"팔레트",conveyor:"컨베이어",amr:"AMR",dock:"출고 구역",scanner:"스캐너",floor:"바닥/벽",rack:"랙",door:"문"};
/** Keeps a floor's edges on the 1-unit grid: odd sizes center on .5, even sizes on whole units. */
export function snapFloorCenter(value:number,size:number){const cell=FLOOR_CONFIG.cell,offset=(size/cell)%2?cell/2:0;return Math.round((value-offset)/cell)*cell+offset;}
export function normalizeFloor(size:Partial<FloorSize>|undefined,current:FloorSize={width:1,depth:1,wallHeight:0}):FloorSize|null{
  const next={...current,...size};
  const cells=(v:number)=>Number.isInteger(v)&&v>=1&&v<=FLOOR_CONFIG.maxSize;
  if(!cells(next.width)||!cells(next.depth)||!Number.isFinite(next.wallHeight)||next.wallHeight<0||next.wallHeight>FLOOR_CONFIG.maxWallHeight)return null;
  return next;
}
const snapFloor=(object:SceneEquipment):SceneEquipment=>object.kind==="floor"&&object.floor?{...object,x:snapFloorCenter(object.x,object.floor.width),z:snapFloorCenter(object.z,object.floor.depth)}:object;
const settings=():EquipmentSettings=>({speed:1,reach:C.reach,capacity:40,spawnInterval:8,enabled:true});
/** Defaults (and legacy/preset values) in real units for `kind`. Exported for the template export snippet (scripts/export-scene-template.devtools.js). */
const DOOR_DEFAULTS:Partial<EquipmentSettings>={doorWidth:DOOR_CONFIG.width,doorHeight:DOOR_CONFIG.height,doorOpen:false};
export const settingsFor=(kind:EquipmentKind,values?:Partial<EquipmentSettings>|null):EquipmentSettings=>migrateSettings(kind,{...settings(),...(kind==="door"?DOOR_DEFAULTS:{}),...values});
/** Doors snap flush to a nearby wall plane (see snapDoorToWall). */
const snapDoor=(object:SceneEquipment,config:EquipmentSettings|undefined,objects:SceneEquipment[]):SceneEquipment=>object.kind==="door"?{...object,...snapDoorToWall(object,config?.doorWidth??DOOR_CONFIG.width,objects)}:object;
interface SceneState{
  inspected:string|null;inspect:(id:string|null)=>void;
  past:SceneSnapshot[];future:SceneSnapshot[];undo:()=>void;redo:()=>void;
  objects:SceneEquipment[];settings:Record<string,EquipmentSettings>;selected:string|null;pending:EquipmentKind|null;/** Settings applied to the next placed `pending` object (asset rail presets). */pendingPreset:Partial<EquipmentSettings>|null;editing:boolean;tool:EditorTool;errors:string[];nextId:number;
  select:(id:string|null)=>void;
  /** Multi-select ids (see selectedIds; `selected` stays the primary/active one for the single-select API). */
  selection:string[];
  /** Shift/Ctrl+click: add/remove `id`; the clicked one becomes primary, removing it promotes the previous one. */
  toggleSelect:(id:string)=>void;
  /** One undo step: removes all ids. */
  removeMany:(ids:string[])=>void;
  /** One undo step: patch per id (object or function of that id's current settings); returns the changed count. */
  updateSettingsMany:(ids:string[],values:Partial<EquipmentSettings>|((config:EquipmentSettings,id:string)=>Partial<EquipmentSettings>))=>number;
  /** One undo step: several pose changes (group move). */
  updatePoses:(changes:{id:string;pose:Partial<EquipmentPose>}[])=>void;setPending:(kind:EquipmentKind|null,preset?:Partial<EquipmentSettings>|null)=>void;setTool:(tool:EditorTool)=>void;
  add:(kind:EquipmentKind,pose:Partial<EquipmentPose>&{floor?:FloorSize})=>void;updateFloor:(id:string,size:Partial<FloorSize>)=>void;updatePose:(id:string,pose:Partial<EquipmentPose>)=>void;
  extendConveyor:(id:string,turn:ConveyorTurn)=>void;
  /** Adds a copy (new id/name, same pose/props/settings) and selects it; returns its id. */
  duplicate:(object:SceneEquipment,settings:EquipmentSettings)=>string|null;
  updateSettings:(id:string,values:Partial<EquipmentSettings>)=>void;remove:(id:string)=>void;
  edit:()=>void;complete:()=>void;clear:()=>void;example:()=>void;
  loadTemplate: (template: SceneTemplate) => boolean;
  /** Equipment relations (🔗); see docs/linking-design.md. */
  links:SceneLink[];nextLinkId:number;
  /** Adds a link (edit mode, valid kind pair, no duplicate); returns whether it was added. */
  addLink:(link:Omit<SceneLink,"id">)=>boolean;removeLink:(id:string)=>void;
}
type SceneSnapshot=Pick<SceneState,"objects"|"settings"|"selected"|"selection"|"nextId"|"links"|"nextLinkId">;
const snapshot=(state:SceneState):SceneSnapshot=>({objects:state.objects,settings:state.settings,selected:state.selected,selection:state.selection,nextId:state.nextId,links:state.links,nextLinkId:state.nextLinkId});
const history=(state:SceneState)=>state.editing?{past:[...state.past,snapshot(state)].slice(-EDITOR_HISTORY_LIMIT),future:[]}:{};
export const useSceneStore=create<SceneState>((set,get)=>({
  past:[],future:[],
  inspected:null,inspect:id=>set(id?{inspected:id,selected:id}:{inspected:null}),
  undo:()=>{const state=get();if(!state.editing||!state.past.length)return;set({...state.past[state.past.length-1],past:state.past.slice(0,-1),future:[snapshot(state),...state.future],pending:null,errors:[]});},
  redo:()=>{const state=get();if(!state.editing||!state.future.length)return;set({...state.future[0],past:[...state.past,snapshot(state)].slice(-EDITOR_HISTORY_LIMIT),future:state.future.slice(1),pending:null,errors:[]});},
  objects:[],settings:{},links:[],nextLinkId:1,selected:null,selection:[],pending:null,pendingPreset:null,editing:true,tool:"translate",errors:[],nextId:1,
  select:selected=>{const state=get();if(state.selected!==selected||state.inspected!==null||state.selection.length>1)set({selected,selection:selected?[selected]:[],inspected:null});},
  toggleSelect:id=>{
    const state=get(),ids=selectedIds(state);
    if(!ids.includes(id)){set({selected:id,selection:[...ids,id],inspected:null});return;}
    const rest=ids.filter(entry=>entry!==id);
    set({selected:rest[rest.length-1]??null,selection:rest,inspected:null});
  },
  removeMany:ids=>{
    const state=get();if(!state.editing)return;
    const gone=new Set(ids.filter(id=>state.settings[id]));if(!gone.size)return;
    const next={...state.settings};for(const id of gone)delete next[id];
    set({...history(state),objects:state.objects.filter(o=>!gone.has(o.id)),links:state.links.filter(l=>!gone.has(l.from)&&!gone.has(l.to)),settings:next,selected:state.selected&&gone.has(state.selected)?null:state.selected,selection:state.selection.filter(id=>!gone.has(id)),errors:[]});
  },
  updateSettingsMany:(ids,values)=>{
    const state=get(),next={...state.settings};let count=0,capacity=false;
    const size=(value:number|undefined,max:number)=>value===undefined||(Number.isFinite(value)&&value>=DOOR_CONFIG.minSize&&value<=max);
    for(const id of ids){
      const config=state.settings[id];if(!config)continue;
      const patch=typeof values==="function"?values(config,id):values;
      if(patch.defectRate!==undefined&&(!Number.isFinite(patch.defectRate)||patch.defectRate<0||patch.defectRate>1))continue;
      if(!size(patch.doorWidth,DOOR_CONFIG.maxWidth)||!size(patch.doorHeight,DOOR_CONFIG.maxHeight))continue;
      if(Object.entries(patch).every(([key,value])=>config[key as keyof EquipmentSettings]===value))continue;
      next[id]={...config,...patch};count++;if(patch.capacity!==undefined)capacity=true;
    }
    if(!count)return 0;
    set({...history(state),settings:next,errors:[]});
    const first=state.objects.find(o=>ids.includes(o.id));
    const warning=typeof values==="function"?null:unrealisticWarning(first?.kind,values);
    if(warning)log("warning",`${count}개 설비: 비현실적인 설정값`,warning);
    if(!get().editing&&capacity)useSimulationStore.getState().reset();
    return count;
  },
  updatePoses:changes=>{
    const state=get();if(!state.editing)return;
    const byId=new Map(changes.map(c=>[c.id,c.pose]));
    let changed=false;
    const objects=state.objects.map(object=>{
      const pose=byId.get(object.id);if(!pose)return object;
      if(Object.entries(pose).every(([key,value])=>Math.abs(object[key as keyof EquipmentPose]-value)<1e-8))return object;
      changed=true;const moved={...object,...pose};
      return object.kind==="conveyor"?snapBelt(moved,state.objects):object.kind==="door"?snapDoor(moved,state.settings[object.id],state.objects):snapFloor(moved);
    });
    if(changed)set({...history(state),objects,errors:[]});
  },setPending:(pending,preset=null)=>{const next=pending?preset:null;if(get().pending!==pending||get().pendingPreset!==next)set({pending,pendingPreset:next});},setTool:tool=>{if(get().tool!==tool)set({tool});},
  add:(kind,pose)=>{
    if(!get().editing)return;
    set(state=>{
      const id=`${kind}-${state.nextId}`,initial:SceneEquipment={...DEFAULT_LAYOUT[kind],...pose,id,kind,name:`${EQUIPMENT_NAMES[kind]} ${state.nextId}`};
      if(kind==="floor")initial.floor=normalizeFloor(pose.floor)??{width:1,depth:1,wallHeight:0};
      const config=settingsFor(kind,state.pending===kind?state.pendingPreset:null);
      const object=kind==="conveyor"?snapBelt(initial,state.objects):kind==="door"?snapDoor(initial,config,state.objects):snapFloor(initial);
      return {...history(state),objects:[...state.objects,object],settings:{...state.settings,[id]:config},selected:id,pending:null,pendingPreset:null,nextId:state.nextId+1,errors:[]};
    });
  },
  duplicate:(source,config)=>{
    const state=get();
    if(!state.editing)return null;
    const id=`${source.kind}-${state.nextId}`;
    const object:SceneEquipment={...source,...(source.floor?{floor:{...source.floor}}:{}),id,name:`${EQUIPMENT_NAMES[source.kind]} ${state.nextId}`};
    set({...history(state),objects:[...state.objects,object],settings:{...state.settings,[id]:migrateSettings(source.kind,{...config})},selected:id,pending:null,pendingPreset:null,nextId:state.nextId+1,errors:[]});
    return id;
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
    const changed={...object,...pose},next=object.kind==="conveyor"?snapBelt(changed,get().objects):object.kind==="door"?snapDoor(changed,get().settings[id],get().objects):snapFloor(changed);
    set(state=>({...history(state),objects:state.objects.map(object=>object.id===id?next:object),errors:[]}));
  },
  updateFloor:(id,size)=>{
    const state=get(),object=state.objects.find(object=>object.id===id);
    if(!state.editing||object?.kind!=="floor"||!object.floor)return;
    const floor=normalizeFloor(size,object.floor);
    if(!floor||(floor.width===object.floor.width&&floor.depth===object.floor.depth&&floor.wallHeight===object.floor.wallHeight))return;
    // Resize symmetrically about the center (the gizmo origin): no re-snap here, which would shift
    // the center by half a cell on odd/even size changes. Moving the floor re-aligns its edges.
    const next={...object,floor};
    set({...history(state),objects:state.objects.map(o=>o.id===id?next:o),errors:[]});
  },
  updateSettings:(id,values)=>{
    const state = get(), current = state.settings[id];
    if (!current) return;
    if (values.defectRate !== undefined && (!Number.isFinite(values.defectRate) || values.defectRate < 0 || values.defectRate > 1)) return;
    const size = (value: number | undefined, max: number) => value === undefined || (Number.isFinite(value) && value >= DOOR_CONFIG.minSize && value <= max);
    if (!size(values.doorWidth, DOOR_CONFIG.maxWidth) || !size(values.doorHeight, DOOR_CONFIG.maxHeight)) return;
    const connected = values.beltSpeed !== undefined && state.objects.some(object => object.id === id && object.kind === "conveyor")
      ? connectedBeltIds(state.objects, id) : new Set([id]);
    const nextSettings = { ...state.settings };
    let changed = false;
    for (const target of connected) {
      const config = state.settings[target];
      if (!config) continue;
      const updates = target === id ? values : { beltSpeed: values.beltSpeed };
      if (Object.entries(updates).every(([key, value]) => config[key as keyof EquipmentSettings] === value)) continue;
      nextSettings[target] = { ...config, ...updates };
      changed = true;
    }
    if (!changed) return;
    set({ ...history(state), settings: nextSettings, errors: [] });
    const object = state.objects.find(entry => entry.id === id);
    const warning = unrealisticWarning(object?.kind, values);
    if (warning) log("warning", `${object?.name ?? id}: 비현실적인 설정값`, warning);
    if(!get().editing&&values.capacity!==undefined)useSimulationStore.getState().reset();
  },
  remove:id=>{if(!get().editing||!get().settings[id])return;set(state=>{const next={...state.settings};delete next[id];return {...history(state),objects:state.objects.filter(object=>object.id!==id),links:state.links.filter(link=>link.from!==id&&link.to!==id),settings:next,selected:state.selected===id?null:state.selected,errors:[]};});},
  edit:()=>{if(get().editing)return;useSimulationStore.getState().reset();set({editing:true,errors:[],inspected:null});},
  complete:()=>{const state=get(),errors=validateScene(state.objects,state.settings);if(!errors.length)useSimulationStore.getState().reset();set({errors,editing:errors.length>0,pending:null,inspected:null});},
  clear:()=>{if(!get().editing)useSimulationStore.getState().reset();set({...history(get()),objects:[],settings:{},links:[],nextLinkId:1,selected:null,pending:null,editing:true,errors:[]});},
  loadTemplate: (template) => {
    const state = get();
    if (!state.editing) return false;
    const objects = template.equipment.map((entry, index) => ({
      kind: entry.kind, x: entry.x, z: entry.z, yaw: entry.yaw, conveyorTurn: entry.conveyorTurn,
      ...(entry.floor ? { floor: { ...entry.floor } } : {}),
      id: `${entry.kind}-${index + 1}`, name: `${EQUIPMENT_NAMES[entry.kind]} ${index + 1}`,
    }));
    const configs = Object.fromEntries(objects.map((object, index) => [
      object.id, settingsFor(object.kind, template.equipment[index].settings),
    ]));
    const errors = validateScene(objects, configs);
    if (errors.length) { set({ errors }); return false; }
    // Template links reference equipment by index; invalid or out-of-range entries are dropped.
    const links: SceneLink[] = [];
    for (const entry of template.links ?? []) {
      const from = objects[entry.from], to = objects[entry.to];
      if (!from || !to || linkTypeFor(from.kind, to.kind) !== entry.type) continue;
      if (links.some((link) => link.type === entry.type && link.from === from.id && link.to === to.id)) continue;
      links.push({ id: `L-${String(links.length + 1).padStart(3, "0")}`, type: entry.type, from: from.id, to: to.id });
    }
    useLinkModeStore.getState().setSource(null);
    set({ ...history(state), objects, settings: configs, links, nextLinkId: links.length + 1, selected: null, inspected: null,
      pending: null, errors: [], nextId: objects.length + 1 });
    return true;
  },
  addLink:(link)=>{
    const state=get();
    if(!state.editing)return false;
    const from=state.objects.find(o=>o.id===link.from),to=state.objects.find(o=>o.id===link.to);
    if(!from||!to||!LINK_RULES[link.type]||linkTypeFor(from.kind,to.kind)!==link.type)return false;
    if(state.links.some(l=>l.type===link.type&&l.from===link.from&&l.to===link.to))return false;
    set({...history(state),links:[...state.links,{...link,id:`L-${String(state.nextLinkId).padStart(3,"0")}`}],nextLinkId:state.nextLinkId+1});
    return true;
  },
  removeLink:id=>{const state=get();if(!state.editing||!state.links.some(l=>l.id===id))return;set({...history(state),links:state.links.filter(l=>l.id!==id)});if(useLinkModeStore.getState().selectedLink===id)useLinkModeStore.getState().selectLink(null);},
  example:()=>{
    if (!get().editing) get().edit();
    get().loadTemplate(SCENE_TEMPLATES[1]);
    get().select(get().objects[0]?.id ?? null);
  },
}));
