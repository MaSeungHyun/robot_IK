import { create } from "zustand";
import type { EquipmentKind,EquipmentPose,SceneEquipment,EquipmentSettings,ConveyorTurn,FloorSize } from "../types/layout";
import { DEFAULT_LAYOUT,SIMULATOR_CONFIG as C,EDITOR_HISTORY_LIMIT,FLOOR_CONFIG } from "../constants/simulatorLayout";
import { useSimulationStore } from "./useSimulationStore";
import { validateScene } from "@/domain/amr/navigation/sceneValidation";
import { beltConnections,connectedBeltIds,extendBelt,snapBelt } from "@/domain/conveyor/conveyorLayout";
import { scannerExtension,scannerOutletTaken } from "@/domain/conveyor/scannerBelt";
import { SCENE_TEMPLATES } from "@/constants/sceneTemplates";
import type { SceneTemplate, TemplateLighting, TemplateProp } from "@/types/sceneTemplate";
import { migrateSettings, unrealisticWarning } from "@/domain/simulation/equipmentSpeeds";
import { log } from "@/stores/useLogStore";
import { LINK_RULES, linkTypeFor, type SceneLink } from "@/types/links";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { DOOR_CONFIG } from "@/constants/door";
import { snapDoorToWall } from "@/domain/room/roomWalls";
import { applyPalletMounts, releaseMounts } from "@/domain/layout/palletMount";
import { onRobotPedestalsChange, robotMountAt } from "@/domain/layout/robotPedestals";
import { arrayPoses, type ArrayOptions } from "@/domain/layout/arrayPlacement";

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
/** Pallets mounted on any of `amrIds` (they belong to the AMR: deleted / copied with it). */
const mountedPallets=(objects:SceneEquipment[],settings:Record<string,EquipmentSettings>,amrIds:ReadonlySet<string>)=>objects.filter(o=>o.kind==="pallet"&&!!settings[o.id]?.mountedOn&&amrIds.has(settings[o.id].mountedOn!));
/** An AMR that is no longer a shuttle (pallet/box AMR, forklift, AGV) loses its mounted pallet: it is deleted, never dropped to the floor (same undo step). */
const pruneMounts=(state:{objects:SceneEquipment[];links:SceneLink[]},settings:Record<string,EquipmentSettings>,ids:readonly string[])=>{
  const amrs=new Set(ids.filter(id=>settings[id]?.amrRole!==undefined&&settings[id].amrRole!=="shuttle"&&state.objects.some(o=>o.id===id&&o.kind==="amr")));
  const gone=new Set(mountedPallets(state.objects,settings,amrs).map(o=>o.id));
  if(!gone.size)return {settings};
  const next={...settings};for(const id of gone)delete next[id];
  return {settings:next,objects:state.objects.filter(o=>!gone.has(o.id)),links:state.links.filter(l=>!gone.has(l.from)&&!gone.has(l.to))};
};
/** Copies of the pallets mounted on `source`, mounted on `copy` (ids from `nextId`). */
const copyMounts=(objects:SceneEquipment[],settings:Record<string,EquipmentSettings>,source:string,copy:SceneEquipment,nextId:number)=>
  mountedPallets(objects,settings,new Set([source])).map((pallet,i)=>({object:{...pallet,x:copy.x,z:copy.z,yaw:copy.yaw,id:`pallet-${nextId+i}`,name:`${EQUIPMENT_NAMES.pallet} ${nextId+i}`} as SceneEquipment,config:migrateSettings("pallet",{...settings[pallet.id],mountedOn:copy.id})}));
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
  add:(kind:EquipmentKind,pose:Partial<EquipmentPose>&{floor?:FloorSize;elevation?:number})=>void;updateFloor:(id:string,size:Partial<FloorSize>)=>void;updatePose:(id:string,pose:Partial<EquipmentPose>)=>void;
  extendConveyor:(id:string,turn:ConveyorTurn)=>void;
  /** Adds a copy (new id/name, same pose/props/settings) and selects it; returns its id. */
  duplicate:(object:SceneEquipment,settings:EquipmentSettings)=>string|null;
  /** Array modifier: count-1 copies of id (same settings) stepped along its local axis; one undo step, copies selected. */
  arrayCopies:(id:string,footprint:readonly [number,number],options:ArrayOptions)=>string[];
  updateSettings:(id:string,values:Partial<EquipmentSettings>)=>void;remove:(id:string)=>void;
  /** Shuttle AMR '팔레트 포함': mounts a new pallet on its deck (on) or removes the mounted one (off); one undo step. */
  setCarriedPallet:(amrId:string,on:boolean)=>void;
  edit:()=>void;complete:()=>void;clear:()=>void;example:()=>void;
  loadTemplate: (template: SceneTemplate) => boolean;
  /** GLB props of the last loaded template (static decor, not part of undo history); cleared by clear(). */
  props: readonly TemplateProp[];
  /** Lighting preset of the last loaded template (null = default lights); cleared by clear(). */
  lighting: TemplateLighting | null;
  /** Equipment relations (🔗); see docs/linking-design.md. */
  links:SceneLink[];nextLinkId:number;
  /** Global "자동 연결": unlinked relations use the nearest target (false: wait + "링크 없음"). Saved in templates. */
  autoConnect:boolean;setAutoConnect:(value:boolean)=>void;
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
  props:[],lighting:null,objects:[],settings:{},links:[],nextLinkId:1,autoConnect:true,setAutoConnect:autoConnect=>{if(get().editing)set({autoConnect});},selected:null,selection:[],pending:null,pendingPreset:null,editing:true,tool:"translate",errors:[],nextId:1,
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
    for(const p of mountedPallets(state.objects,state.settings,gone))gone.add(p.id);
    let next={...state.settings};for(const id of gone){delete next[id];next=releaseMounts(next,id);}
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
    set({...history(state),...pruneMounts(state,next,ids),errors:[]});
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
      if(object.kind==="robot"){const m=robotMountAt(moved.x,moved.z,false);return {...snapFloor(moved),elevation:m.elevation||undefined};}// [pedestal] lift onto / drop off a robot pedestal
      return object.kind==="conveyor"?snapBelt(moved,state.objects):object.kind==="door"?snapDoor(moved,state.settings[object.id],state.objects):snapFloor(moved);
    });
    if(changed)set({...history(state),...applyPalletMounts({objects,settings:state.settings},changes.map(c=>c.id)),errors:[]});
  },setPending:(pending,preset=null)=>{const next=pending?preset:null;if(get().pending!==pending||get().pendingPreset!==next)set({pending,pendingPreset:next});},setTool:tool=>{if(get().tool!==tool)set({tool});},
  add:(kind,pose)=>{
    if(!get().editing)return;
    set(state=>{
      const id=`${kind}-${state.nextId}`,initial:SceneEquipment={...DEFAULT_LAYOUT[kind],...pose,id,kind,name:`${EQUIPMENT_NAMES[kind]} ${state.nextId}`};
      if(kind==="floor")initial.floor=normalizeFloor(pose.floor)??{width:1,depth:1,wallHeight:0};
      const config=settingsFor(kind,{...(kind==="conveyor"?{autoSpawn:false}:{}),...(state.pending===kind?state.pendingPreset:null)});
      let object=kind==="conveyor"?snapBelt(initial,state.objects):kind==="door"?snapDoor(initial,config,state.objects):snapFloor(initial);
      // [pedestal] a robot added over robot_base / robot_arm_place sits on its top face (base: XZ centre).
      if(kind==="robot"&&pose.elevation===undefined){const m=robotMountAt(object.x,object.z,true);object={...object,x:m.x,z:m.z,...(m.elevation?{elevation:m.elevation}:{})};}
      const scene=applyPalletMounts({objects:[...state.objects,object],settings:{...state.settings,[id]:config}},[id]);
      // A new shuttle AMR comes with its pallet mounted on the deck (the cycle swaps it, it never starts empty).
      if(kind==="amr"&&config.amrRole==="shuttle"){
        const palletId=`pallet-${state.nextId+1}`;
        scene.objects=[...scene.objects,{...DEFAULT_LAYOUT.pallet,x:object.x,z:object.z,yaw:object.yaw,id:palletId,kind:"pallet",name:`${EQUIPMENT_NAMES.pallet} ${state.nextId+1}`}];
        scene.settings={...scene.settings,[palletId]:settingsFor("pallet",{mountedOn:id})};
        return {...history(state),...scene,selected:id,pending:null,pendingPreset:null,nextId:state.nextId+2,errors:[]};
      }
      return {...history(state),...scene,selected:id,pending:null,pendingPreset:null,nextId:state.nextId+1,errors:[]};
    });
  },
  duplicate:(source,config)=>{
    const state=get();
    if(!state.editing)return null;
    const id=`${source.kind}-${state.nextId}`;
    const object:SceneEquipment={...source,...(source.floor?{floor:{...source.floor}}:{}),id,name:`${EQUIPMENT_NAMES[source.kind]} ${state.nextId}`};
    // A shuttle's mounted pallet is copied with it (on the copy's deck).
    const riders=source.kind==="amr"?copyMounts(state.objects,state.settings,source.id,object,state.nextId+1):[];
    const settings={...state.settings,[id]:migrateSettings(source.kind,{...config})};for(const r of riders)settings[r.object.id]=r.config;
    set({...history(state),objects:[...state.objects,object,...riders.map(r=>r.object)],settings,selected:id,pending:null,pendingPreset:null,nextId:state.nextId+1+riders.length,errors:[]});
    return id;
  },
  arrayCopies:(id,footprint,options)=>{
    const state=get(),source=state.objects.find(o=>o.id===id);
    if(!state.editing||!source)return [];
    const poses=arrayPoses(source,footprint,options);
    if(!poses.length)return [];
    const copies=poses.map((pose,i)=>({...source,...pose,id:`${source.kind}-${state.nextId+i}`,name:`${EQUIPMENT_NAMES[source.kind]} ${state.nextId+i}`}));
    const settings={...state.settings};
    for(const copy of copies)settings[copy.id]=migrateSettings(source.kind,{...state.settings[id]});
    const ids=copies.map(c=>c.id);
    let nextId=state.nextId+copies.length;const riders:SceneEquipment[]=[];
    if(source.kind==="amr")for(const copy of copies)for(const r of copyMounts(state.objects,state.settings,id,copy,nextId)){riders.push(r.object);settings[r.object.id]=r.config;nextId++;}
    set({...history(state),objects:[...state.objects,...copies,...riders],settings,selected:id,selection:[...ids,id],pending:null,pendingPreset:null,nextId,errors:[]});
    return ids;
  },
  extendConveyor:(id,turn)=>{
    const state=get(),source=state.objects.find(o=>o.id===id&&(o.kind==="conveyor"||o.kind==="scanner"));
    if(!state.editing||!source)return;
    // A scanner extends from its tunnel exit (rail.glb at native length), like a conveyor from its end.
    const scanner=source.kind==="scanner";
    if(scanner?scannerOutletTaken(source,state.objects):beltConnections(state.objects).next.has(id))return;
    const pose=scanner?scannerExtension(source,turn):extendBelt(source,turn);
    const nextId=`conveyor-${state.nextId}`,object={...pose,id:nextId,kind:"conveyor" as const,name:`컨베이어 ${state.nextId}`};
    set({...history(state),objects:[...state.objects,object],settings:{...state.settings,[nextId]:scanner?settingsFor("conveyor",{autoSpawn:false}):{...state.settings[id]}},selected:nextId,pending:null,nextId:state.nextId+1,errors:[]});
  },
  updatePose:(id,pose)=>{
    if(!get().editing)return;
    const object=get().objects.find(object=>object.id===id);
    if(!object||Object.entries(pose).every(([key,value])=>Math.abs(object[key as keyof EquipmentPose]-value)<1e-8))return;
    const changed={...object,...pose},next=object.kind==="conveyor"?snapBelt(changed,get().objects):object.kind==="door"?snapDoor(changed,get().settings[id],get().objects):snapFloor(changed);
    set(state=>({...history(state),...applyPalletMounts({objects:state.objects.map(object=>object.id===id?next:object),settings:state.settings},[id]),errors:[]}));
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
    set({ ...history(state), ...pruneMounts(state, nextSettings, [id]), errors: [] });
    const object = state.objects.find(entry => entry.id === id);
    const warning = unrealisticWarning(object?.kind, values);
    if (warning) log("warning", `${object?.name ?? id}: 비현실적인 설정값`, warning);
    if(!get().editing&&values.capacity!==undefined)useSimulationStore.getState().reset();
  },
  setCarriedPallet:(amrId,on)=>{
    const state=get(),amr=state.objects.find(object=>object.id===amrId);
    if(!state.editing||!amr||amr.kind!=="amr")return;
    const mounted=state.objects.find(object=>object.kind==="pallet"&&state.settings[object.id]?.mountedOn===amrId);
    if(on===Boolean(mounted))return;
    set(current=>{
      if(mounted){
        const next={...current.settings};delete next[mounted.id];
        return {...history(current),objects:current.objects.filter(object=>object.id!==mounted.id),links:current.links.filter(link=>link.from!==mounted.id&&link.to!==mounted.id),settings:next,errors:[]};
      }
      const palletId=`pallet-${current.nextId}`;
      const objects=[...current.objects,{...DEFAULT_LAYOUT.pallet,x:amr.x,z:amr.z,yaw:amr.yaw,id:palletId,kind:"pallet" as const,name:`${EQUIPMENT_NAMES.pallet} ${current.nextId}`}];
      const settings={...current.settings,[palletId]:settingsFor("pallet",{mountedOn:amrId}),[amrId]:{...current.settings[amrId],amrRole:"shuttle" as const}};
      return {...history(current),objects,settings,nextId:current.nextId+1,errors:[]};
    });
  },
  remove:id=>{if(!get().editing||!get().settings[id])return;set(state=>{const gone=new Set([id,...mountedPallets(state.objects,state.settings,new Set([id])).map(o=>o.id)]);const next={...state.settings};for(const g of gone)delete next[g];return {...history(state),objects:state.objects.filter(object=>!gone.has(object.id)),links:state.links.filter(link=>!gone.has(link.from)&&!gone.has(link.to)),settings:next,selected:state.selected&&gone.has(state.selected)?null:state.selected,selection:state.selection.filter(s=>!gone.has(s)),errors:[]};});},
  edit:()=>{if(get().editing)return;useSimulationStore.getState().reset();set({editing:true,errors:[],inspected:null});},
  complete:()=>{const state=get(),errors=validateScene(state.objects,state.settings,state.links);if(!errors.length)useSimulationStore.getState().reset();set({errors,editing:errors.length>0,pending:null,inspected:null});},
  clear:()=>{if(!get().editing)useSimulationStore.getState().reset();set({...history(get()),props:[],lighting:null,objects:[],settings:{},links:[],nextLinkId:1,autoConnect:true,selected:null,pending:null,editing:true,errors:[]});},
  loadTemplate: (template) => {
    const state = get();
    if (!state.editing) return false;
    const objects = template.equipment.map((entry, index) => ({
      kind: entry.kind, x: entry.x, z: entry.z, yaw: entry.yaw, conveyorTurn: entry.conveyorTurn,
      ...(entry.conveyorPath ? { conveyorPath: entry.conveyorPath } : {}), ...(entry.conveyorLength ? { conveyorLength: entry.conveyorLength } : {}), ...(entry.elevation ? { elevation: entry.elevation } : {}),
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
    set({ ...history(state), props: template.props ?? [], lighting: template.lighting ?? null, objects, settings: configs, links, nextLinkId: links.length + 1, autoConnect: template.autoConnect ?? true, selected: null, inspected: null,
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

/**
 * Pedestal GLB props (robot_base / robot_arm_place) register after their GLB loads, i.e. after a template/scene is set:
 * re-seat every robot then. Over a pedestal the arm stands on its *_point height (x/z untouched); elsewhere on the floor.
 * Editing only (Play builds the simulator from the poses at start); not an undo step.
 */
onRobotPedestalsChange(()=>{
  const state=useSceneStore.getState();
  if(!state.editing)return;
  let changed=false;
  const objects=state.objects.map(object=>{
    if(object.kind!=="robot"||(state.settings[object.id]?.robotPedestal??"none")!=="none")return object;
    const elevation=robotMountAt(object.x,object.z,false).elevation||undefined;
    if(elevation===object.elevation)return object;
    changed=true;
    const next={...object,elevation};
    if(elevation===undefined)delete next.elevation;
    return next;
  });
  if(changed)useSceneStore.setState({objects});
});
