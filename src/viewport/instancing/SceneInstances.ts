import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Vector3 } from "three";
import type { BufferGeometry, Material, Object3D } from "three";
import { INSTANCE_SECTOR_SIZE } from "@/constants/viewport";
import { profileEnd, profileStart } from "@/lib/profiler/frameProfiler";

/** geometry: what is drawn (the node's own, or its userData.lowPoly stand-in once the owner is static). */
type Entry={node:Mesh;owner:Object3D;visible:boolean;raycast:Mesh["raycast"];previous:Matrix4;batch:Batch;geometry:BufferGeometry;sector:string};
/** dirty: entries changed since the last sync; only those batches are reordered/rewritten. */
type Batch={geometry:BufferGeometry;material:Material|Material[];entries:Set<Entry>;mesh:InstancedMesh|null;capacity:number;ordered:Entry[];castShadow:boolean;dirty:boolean};
/** Per-owner frame state: static owners whose world matrix and visibility did not change are skipped. */
type OwnerFrame={visible:boolean;skip:boolean;previous:Matrix4;seen:boolean};
/** nested: cargo nodes (userData.cargo) found inside this owner at register time, registered as their own owners. */
type Registration={entries:Entry[];references:number;frame:OwnerFrame;lowPoly:boolean;nested:Object3D[]};
const isDescendant=(node:Object3D,ancestor:Object3D)=>{
  for(let n:Object3D|null=node.parent;n;n=n.parent)if(n===ancestor)return true;
  return false;
};
const noRaycast:Mesh["raycast"]=()=>{};
const hiddenScale = new Vector3(0, 0, 0);

/** Keeps original scene transforms/bounds for IK; only the draw representation is batched. */
export class SceneInstances {
  readonly root=new Group();
  private batches=new Map<string,Batch>();
  /** lowPoly: entries already moved to their low-poly stand-ins (static owners only, one-way). */
  private owners=new Map<Object3D,Registration>();
  private sources=new Map<Object3D,Entry>();
  private roots=new WeakSet<Object3D>();
  private inverse=new Matrix4();
  private matrix=new Matrix4();
  private dirty=true;
  forEachSelected(id:string,visit:(mesh:Mesh)=>void){
    for(const entry of this.sources.values()){
      let selected=false,visible=true,identified=false;
      for(let node:Object3D|null=entry.owner;node;node=node.parent){
        if(!node.visible&&!this.sources.has(node)){visible=false;break;}
        if(!identified&&node.userData.cargo){identified=true;selected=node.userData.boxId===id;}
        if(!identified&&node.userData.sceneId){identified=true;selected=node.userData.sceneId===id;}
      }
      if(selected&&visible)visit(entry.node);
    }
  }
  register(owner:Object3D){
    const existing=this.owners.get(owner);
    if(existing){existing.references++;return()=>this.unregister(owner);}
    this.roots.add(owner);
    owner.updateWorldMatrix(true, false);
    let isStatic = false;
    for (let node: Object3D | null = owner; node; node = node.parent) {
      if (node.userData.instanceStatic) { isStatic = true; break; }
    }
    // Dynamic equipment stays batched together. Static sectors retain independent bounds.
    const sector = isStatic
      ? `${Math.floor(owner.matrixWorld.elements[12] / INSTANCE_SECTOR_SIZE)},${Math.floor(owner.matrixWorld.elements[14] / INSTANCE_SECTOR_SIZE)}`
      : "dynamic";
    const entries:Entry[]=[],nested:Object3D[]=[];
    const visit=(node:Object3D)=>{
      if(node!==owner&&this.roots.has(node))return;
      // A box born inside a pallet group (inbound pallets) is its own owner: a robot reparents it to its gripper, and
      // the pallet owner's static skip / visibility / unregister must not freeze, hide or drop it there.
      if(node!==owner&&node.userData.cargo){nested.push(node);this.register(node);return;}
      if(!(node instanceof Mesh)||node.userData.excludeFromInstancing||"isSkinnedMesh" in node||node instanceof InstancedMesh||!node.visible||this.sources.has(node)){
        for(const child of node.children)visit(child);return;
      }
      const batch=this.batchFor(node,node.geometry,sector);
      const entry:Entry={node,owner,visible:node.visible,raycast:node.raycast,previous:new Matrix4(),batch,geometry:node.geometry,sector};
      entries.push(entry);batch.entries.add(entry);batch.dirty=true;this.sources.set(node,entry);node.visible=false;node.raycast=noRaycast;
      for(const child of node.children)visit(child);
    };
    visit(owner);
    this.owners.set(owner,{entries,references:1,frame:{visible:true,skip:false,previous:new Matrix4(),seen:false},lowPoly:false,nested});this.dirty=true;
    return()=>this.unregister(owner);
  }
  private batchFor(node:Mesh,geometry:BufferGeometry,sector:string){
    const materials=Array.isArray(node.material)?node.material:[node.material];
    const key=`${geometry.userData.instanceGeometryKey??geometry.uuid}:${materials.map(m=>m.uuid).join(":")}:${!node.userData.noCastShadow}:${sector}`;
    let batch=this.batches.get(key);
    // Meshes tagged userData.noCastShadow (boxes, pallets) only receive shadows.
    if(!batch){batch={geometry,material:node.material,entries:new Set(),mesh:null,capacity:0,ordered:[],castShadow:!node.userData.noCastShadow,dirty:true};this.batches.set(key,batch);}
    return batch;
  }
  /** LOD: a static owner (racked pallet) switches meshes that offer geometry.userData.lowPoly to that stand-in. */
  private useLowPoly(registration:{entries:Entry[];lowPoly:boolean}){
    registration.lowPoly=true;
    for(const entry of registration.entries){
      const low=entry.node.geometry.userData.lowPoly as BufferGeometry|undefined;
      if(!low||entry.geometry===low)continue;
      entry.batch.entries.delete(entry);entry.batch.dirty=true;
      entry.batch=this.batchFor(entry.node,low,entry.sector);entry.geometry=low;
      entry.batch.entries.add(entry);entry.batch.dirty=true;this.dirty=true;
    }
  }
  /** Nested cargo owners left registered after their parent went (box taken off the pallet first). */
  private orphans=new Set<Object3D>();
  /** deep: also drop every nested cargo owner, wherever it is now (run teardown). */
  unregister(owner:Object3D,deep=false){
    const registration=this.owners.get(owner);if(!registration)return;
    if(--registration.references>0&&!deep)return;
    this.orphans.delete(owner);
    for(const entry of registration.entries){
      entry.node.visible=entry.visible;entry.node.raycast=entry.raycast;
      this.sources.delete(entry.node);
      entry.batch.entries.delete(entry);entry.batch.dirty=true;
    }
    this.owners.delete(owner);this.dirty=true;
    // Boxes still riding on this owner leave with it; ones already taken off (gripper, belt) stay registered.
    for(const child of registration.nested){
      if(deep||isDescendant(child,owner)){const r=this.owners.get(child);if(r)r.references=1;this.unregister(child,deep);}
      else if(this.owners.has(child))this.orphans.add(child);
    }
  }
  /** Run teardown: drop nested cargo owners whose pallet was unregistered earlier (boxes still on belts / grippers). */
  releaseOrphans(){
    for(const owner of [...this.orphans])this.unregister(owner,true);
    this.orphans.clear();
  }
  sync(){
    // LOD pre-pass (before batches are rebuilt): owners that turned static switch to low-poly stand-ins.
    for(const registration of this.owners.values()){
      if(registration.lowPoly)continue;
      for(let node:Object3D|null=registration.entries[0]?.owner??null;node;node=node.parent)
        if(node.userData.instanceStatic){this.useLowPoly(registration);break;}
    }
    if(this.dirty){
      const rebuildStart=profileStart();
      for(const [key,batch] of this.batches){
        if(!batch.dirty)continue;
        batch.ordered=[...batch.entries];
        if(!batch.ordered.length){batch.mesh?.removeFromParent();batch.mesh?.dispose();this.batches.delete(key);continue;}
        if(batch.ordered.length>batch.capacity){
          batch.mesh?.removeFromParent();batch.mesh?.dispose();
          batch.capacity=2**Math.ceil(Math.log2(Math.max(16,batch.ordered.length)));
          batch.mesh=new InstancedMesh(batch.geometry,batch.material,batch.capacity);
          batch.mesh.instanceMatrix.setUsage(DynamicDrawUsage);batch.mesh.frustumCulled=true;
          // Equipment and cargo cast and receive the key light shadow (off = the light stops casting).
          batch.mesh.castShadow=batch.castShadow;batch.mesh.receiveShadow=true;
          this.root.add(batch.mesh);
        }
        batch.mesh!.count=batch.ordered.length;
        batch.mesh!.userData.instanceOwners=batch.ordered.map(entry=>entry.owner);
      }
      this.dirty=false;
      profileEnd("rebuild",rebuildStart);
    }
    this.root.updateWorldMatrix(true,false);this.inverse.copy(this.root.matrixWorld).invert();
    // One ancestor walk per owner (not per entry): visibility + whether it is tagged static
    // (userData.instanceStatic on it or an ancestor: racks, docks, conveyors, stored pallets).
    // A static owner whose world matrix and visibility are unchanged keeps last frame's instances;
    // its matrices are still rewritten when its batch was reordered (batch.dirty).
    for(const [owner,registration] of this.owners){
      const frame=registration.frame;
      let visible=true,isStatic=false;
      for(let node:Object3D|null=owner;node;node=node.parent){
        if(!node.visible&&!this.sources.has(node))visible=false;
        if(node.userData.instanceStatic)isStatic=true;
      }
      if(isStatic&&frame.seen){
        owner.updateWorldMatrix(true,false);
        if(frame.visible===visible&&frame.previous.equals(owner.matrixWorld)){frame.skip=true;continue;}
        owner.updateWorldMatrix(false,true);
      }else owner.updateWorldMatrix(true,true);
      frame.skip=false;frame.seen=true;frame.visible=visible;frame.previous.copy(owner.matrixWorld);
    }
    for(const batch of this.batches.values()){
      const reordered=batch.dirty;batch.dirty=false;
      let changed=false;
      for(let i=0;i<batch.ordered.length;i++){
        const entry=batch.ordered[i];
        const frame=this.owners.get(entry.owner)?.frame;
        if(frame?.skip&&!reordered)continue;
        this.matrix.multiplyMatrices(this.inverse,entry.node.matrixWorld);
        // Source meshes are intentionally hidden; a hidden wrist must not hide attached cargo.
        // Preserve translation when hiding: zeroing it would inflate far-away sector bounds
        // all the way back to the world origin.
        if(frame&&!frame.visible)this.matrix.scale(hiddenScale);
        if(reordered||!entry.previous.equals(this.matrix)){
          batch.mesh!.setMatrixAt(i,this.matrix);entry.previous.copy(this.matrix);changed=true;
        }
      }
      if(changed){
        batch.mesh!.instanceMatrix.needsUpdate=true;
        batch.mesh!.boundingBox=null;
        // Refresh only on changes; camera and shadow-camera culling share these current bounds.
        batch.mesh!.computeBoundingSphere();
      }
    }
  }
  dispose(){
    for(const owner of [...this.owners.keys()]){const r=this.owners.get(owner);if(!r)continue;r.references=1;this.unregister(owner);}
    for(const batch of this.batches.values())batch.mesh?.dispose();
    this.root.clear();this.batches.clear();
  }
}
