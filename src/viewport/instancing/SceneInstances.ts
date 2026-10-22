import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Vector3 } from "three";
import type { BufferGeometry, Material, Object3D } from "three";
import { INSTANCE_SECTOR_SIZE } from "@/constants/viewport";

type Entry={node:Mesh;owner:Object3D;visible:boolean;raycast:Mesh["raycast"];previous:Matrix4};
type Batch={geometry:BufferGeometry;material:Material|Material[];entries:Set<Entry>;mesh:InstancedMesh|null;capacity:number;ordered:Entry[];castShadow:boolean};
/** Per-owner frame state: static owners whose world matrix and visibility did not change are skipped. */
type OwnerFrame={visible:boolean;skip:boolean;previous:Matrix4;seen:boolean};
const noRaycast:Mesh["raycast"]=()=>{};
const hiddenScale = new Vector3(0, 0, 0);

/** Keeps original scene transforms/bounds for IK; only the draw representation is batched. */
export class SceneInstances {
  readonly root=new Group();
  private batches=new Map<string,Batch>();
  private owners=new Map<Object3D,{entries:Entry[];references:number;frame:OwnerFrame}>();
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
    const entries:Entry[]=[];
    const visit=(node:Object3D)=>{
      if(node!==owner&&this.roots.has(node))return;
      if(!(node instanceof Mesh)||node.userData.excludeFromInstancing||"isSkinnedMesh" in node||node instanceof InstancedMesh||!node.visible||this.sources.has(node)){
        for(const child of node.children)visit(child);return;
      }
      const materials=Array.isArray(node.material)?node.material:[node.material];
      const key=`${node.geometry.userData.instanceGeometryKey??node.geometry.uuid}:${materials.map(m=>m.uuid).join(":")}:${!node.userData.noCastShadow}:${sector}`;
      let batch=this.batches.get(key);
      // Meshes tagged userData.noCastShadow (boxes, pallets) only receive shadows.
      if(!batch){batch={geometry:node.geometry,material:node.material,entries:new Set(),mesh:null,capacity:0,ordered:[],castShadow:!node.userData.noCastShadow};this.batches.set(key,batch);}
      const entry={node,owner,visible:node.visible,raycast:node.raycast,previous:new Matrix4()};
      entries.push(entry);batch.entries.add(entry);this.sources.set(node,entry);node.visible=false;node.raycast=noRaycast;
      for(const child of node.children)visit(child);
    };
    visit(owner);
    this.owners.set(owner,{entries,references:1,frame:{visible:true,skip:false,previous:new Matrix4(),seen:false}});this.dirty=true;
    return()=>this.unregister(owner);
  }
  unregister(owner:Object3D){
    const registration=this.owners.get(owner);if(!registration)return;
    if(--registration.references>0)return;
    for(const entry of registration.entries){
      entry.node.visible=entry.visible;entry.node.raycast=entry.raycast;
      this.sources.delete(entry.node);
      for(const batch of this.batches.values())batch.entries.delete(entry);
    }
    this.owners.delete(owner);this.dirty=true;
  }
  sync(){
    const topologyChanged=this.dirty;
    if(this.dirty){
      for(const [key,batch] of this.batches){
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
    }
    this.root.updateWorldMatrix(true,false);this.inverse.copy(this.root.matrixWorld).invert();
    // One ancestor walk per owner (not per entry): visibility + whether it is tagged static
    // (userData.instanceStatic on it or an ancestor: racks, docks, conveyors, stored pallets).
    // A static owner whose world matrix and visibility are unchanged keeps last frame's instances.
    for(const [owner,registration] of this.owners){
      const frame=registration.frame;
      let visible=true,isStatic=false;
      for(let node:Object3D|null=owner;node;node=node.parent){
        if(!node.visible&&!this.sources.has(node))visible=false;
        if(node.userData.instanceStatic)isStatic=true;
      }
      if(isStatic&&frame.seen&&!topologyChanged){
        owner.updateWorldMatrix(true,false);
        if(frame.visible===visible&&frame.previous.equals(owner.matrixWorld)){frame.skip=true;continue;}
        owner.updateWorldMatrix(false,true);
      }else owner.updateWorldMatrix(true,true);
      frame.skip=false;frame.seen=true;frame.visible=visible;frame.previous.copy(owner.matrixWorld);
    }
    for(const batch of this.batches.values()){
      let changed=false;
      for(let i=0;i<batch.ordered.length;i++){
        const entry=batch.ordered[i];
        const frame=this.owners.get(entry.owner)?.frame;
        if(frame?.skip)continue;
        this.matrix.multiplyMatrices(this.inverse,entry.node.matrixWorld);
        // Source meshes are intentionally hidden; a hidden wrist must not hide attached cargo.
        // Preserve translation when hiding: zeroing it would inflate far-away sector bounds
        // all the way back to the world origin.
        if(frame&&!frame.visible)this.matrix.scale(hiddenScale);
        if(topologyChanged||!entry.previous.equals(this.matrix)){
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
    for(const owner of [...this.owners.keys()]){this.owners.get(owner)!.references=1;this.unregister(owner);}
    for(const batch of this.batches.values())batch.mesh?.dispose();
    this.root.clear();this.batches.clear();
  }
}
