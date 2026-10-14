import { Box3, CatmullRomCurve3, Group, Vector3 } from "three";
import { OnlinePacker, type Placement } from "./onlinePacking";
import type { Transfer } from "./Robot";
import { randomPerfectSet } from "./perfectTiling";
import { candidateKey, type CandidateView, type PackingSnapshot } from "./packingDiagnostics";

import { BOX_SIZES, BOX_BASE_SIZE, PALLET_BASE_SIZE, STREAM_CONFIG, CONVEYOR_PATH } from "./constants";
export { BOX_SIZES, STREAM_CONFIG } from "./constants";

// Normalize once. The wrapper origin is the top-face centre (GripPoint).
export function createUnitBox(asset: Group) {
  const model = asset.clone(true);
  const native = new Box3().setFromObject(model).getSize(new Vector3());
  if(native.toArray().some(value=>!Number.isFinite(value)||value<=0))throw Error("Invalid box model bounds");
  model.scale.multiply(new Vector3(BOX_BASE_SIZE.x/native.x, BOX_BASE_SIZE.y/native.y, BOX_BASE_SIZE.z/native.z));
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x, bounds.max.y, center.z));
  const unit = new Group();
  unit.add(model);
  unit.updateWorldMatrix(true,true);
  return unit;
}

// Unit pallet origin is its bottom-face centre. Apply final size only
// on the wrapper so exported scales never affect packing coordinates.
export function createUnitPallet(asset: Group) {
  const model=asset.clone(true);
  const native=new Box3().setFromObject(model).getSize(new Vector3());
  if(native.toArray().some(value=>!Number.isFinite(value)||value<=0))throw Error("Invalid pallet model bounds");
  model.scale.multiply(new Vector3(PALLET_BASE_SIZE.x/native.x,PALLET_BASE_SIZE.y/native.y,PALLET_BASE_SIZE.z/native.z));
  const bounds=new Box3().setFromObject(model),center=bounds.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x,bounds.min.y,center.z));
  const unit=new Group();unit.add(model);unit.updateWorldMatrix(true,true);
  return unit;
}
type Item = {
  node: Group;
  size: Vector3;
  distance: number;
  state: "moving" | "reserved" | "held" | "placed" | "departing" | "passed";
  attempted?: boolean;
};
export type StreamStats = {
  spawned: number;
  placed: number;
  passed: number;
  live: number;
  utilization: number;
  full: boolean;
  size: string;
  palletNumber?: number;
  completedPallets?: number;
  exchanging?: boolean;
};

export class ConveyorWorld {
  readonly root = new Group();
  readonly curve = new CatmullRomCurve3(CONVEYOR_PATH.map(point => point.clone()));
  readonly jobs: Transfer[] = [];
  packer: OnlinePacker;
  readonly length = this.curve.getLength();
  readonly palletTop: number;
  pallet: Group;
  readonly palletTemplate: Group;
  readonly palletMotion = new Group();
  exchange: "outgoing" | "incoming" | null = null;
  palletNumber = 1;
  completedPallets = 0;
  items: Item[] = [];
  spawned = 0;
  placed = 0;
  passed = 0;
  travel = 0;
  busy = false;
  full = false;
  lastSize = "";
  robotZ = 0;
  readonly boxAsset: Group;
  readonly random: () => number;
  private supply: number[] = [];
  private diagnosticCandidates:CandidateView[]=[];
  private diagnosticSelected:CandidateView|null=null;
  private readonly inspectedCandidates=new Set<string>();
  private diagnosticPhase="대기";
  private diagnosticReason="먼 쪽(-X)부터 후보 생성";
  private placedFootprints:(Placement&{id:number})[]=[];
  constructor(boxAsset: Group, palletAsset: Group, random:()=>number = Math.random) {
    this.random = random;
    this.boxAsset = createUnitBox(boxAsset);
    const pallet = createUnitPallet(palletAsset);
    this.palletTemplate = pallet.clone(true);
    this.pallet = pallet;
    pallet.userData.collisionRole="pallet";
    pallet.scale.set(STREAM_CONFIG.palletWidth/PALLET_BASE_SIZE.x,STREAM_CONFIG.palletHeight/PALLET_BASE_SIZE.y,STREAM_CONFIG.palletDepth/PALLET_BASE_SIZE.z);
    pallet.position.copy(STREAM_CONFIG.center);
    this.palletTop = STREAM_CONFIG.center.y + STREAM_CONFIG.palletHeight;
    this.packer = new OnlinePacker(new Vector3(STREAM_CONFIG.palletWidth, STREAM_CONFIG.maxStackHeight, STREAM_CONFIG.palletDepth));
    this.root.add(pallet);
    this.root.add(this.palletMotion);
    for (
      let distance = 0;
      distance < this.length;
      distance += STREAM_CONFIG.spacing
    )
      this.spawn(distance);
  }
  spawn(distance = 0) {
    if(!this.supply.length){
      const heights=Array.from({length:Math.floor(STREAM_CONFIG.maxStackHeight/2)},()=>2);
      if(STREAM_CONFIG.maxStackHeight%2)heights.push(1);
      for(const height of heights){
      const indices=BOX_SIZES.map((size,index)=>({size,index})).filter(p=>p.size.y===height);
      const inventory=randomPerfectSet(STREAM_CONFIG.palletWidth,STREAM_CONFIG.palletDepth,
        indices.map(p=>[p.size.x,p.size.z] as [number,number]),this.random);
      if(!inventory)throw Error("Configured box footprints cannot tile the pallet");
      for(let t=0;t<inventory.length;t++)for(let n=0;n<inventory[t].count;n++)this.supply.push(indices[t].index);
      }
      for(let n=this.supply.length-1;n>0;n--){const j=Math.floor(this.random()*(n+1));[this.supply[n],this.supply[j]]=[this.supply[j],this.supply[n]];}
    }
    const size = BOX_SIZES[this.supply.pop()!].clone();
    const model = this.boxAsset.clone(true);
    model.scale.set(size.x/BOX_BASE_SIZE.x, size.y/BOX_BASE_SIZE.y, size.z/BOX_BASE_SIZE.z);
    const node = new Group();
    node.userData.collisionRole="conveyor";
    node.add(model);
    this.root.add(node);
    const item: Item = { node, size, distance, state: "moving" };
    this.items.push(item);
    this.spawned++;
    this.move(item);
  }
  private move(item: Item) {
    item.node.position.copy(
      this.curve.getPointAt(Math.min(1, item.distance / this.length)),
    );
    item.node.position.y += item.size.y;
    item.node.updateWorldMatrix(true, true);
  }
  advance(dt: number) {
    for (const item of this.items) {
      if (item.state !== "moving" && item.state !== "reserved") continue;
      item.distance += STREAM_CONFIG.speed * dt;
      this.move(item);
      if (item.distance > this.length && item.state === "moving")
        this.pass(item);
    }
    this.travel += STREAM_CONFIG.speed * dt;
    while (this.travel >= STREAM_CONFIG.spacing) {
      this.travel -= STREAM_CONFIG.spacing;
      this.spawn(this.travel);
    }
    this.items = this.items.filter((item) => item.state !== "passed");
    if(this.exchange){this.advanceExchange(dt);return;}
    if (this.busy) return;
    // A single large box not fitting does not mean the pallet is full.
    // Exchange only when none of the configured sizes can be supported.
    if(this.packer.count>0&&BOX_SIZES.every(size=>this.packer.candidates(size).length===0)){
      this.beginExchange();return;
    }
    const candidates = this.items
      .filter(
        (item) =>
          item.state === "moving" &&
          !item.attempted &&
          item.node.position.z >= STREAM_CONFIG.pickupStartZ &&
          item.node.position.z <= STREAM_CONFIG.pickupEndZ,
      )
      .sort(
        (a, b) =>
          (this.packer.candidates(a.size,STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0]?.bottom??Infinity)
          -(this.packer.candidates(b.size,STREAM_CONFIG.palletApproachDirection,BOX_SIZES)[0]?.bottom??Infinity)||
          Math.abs(a.node.position.z - this.robotZ) -
          Math.abs(b.node.position.z - this.robotZ),
      );
    for (const item of candidates) {
      const placements = this.packer.candidates(item.size, STREAM_CONFIG.palletApproachDirection, BOX_SIZES);
      // Lowest layer, then far side toward the robot. Retries keep this order.
      const placement = placements[0];
      if (!placement) {
        this.full = true;
        item.attempted = true;
        continue;
      }
      this.reserve(item, placement, placements);
      break;
    }
  }
  private beginExchange() {
    if(this.busy||this.exchange)return;
    this.exchange="outgoing";this.full=true;
    this.palletMotion.position.set(0,0,0);
    this.palletMotion.attach(this.pallet);
    for(const item of this.items)if(item.state==="placed"){
      this.palletMotion.attach(item.node);item.state="departing";
    }
  }
  private advanceExchange(dt:number) {
    const step=STREAM_CONFIG.palletExchangeSpeed*dt;
    if(this.exchange==="outgoing"){
      this.palletMotion.position.x=Math.max(-STREAM_CONFIG.palletExchangeDistance,this.palletMotion.position.x-step);
      if(this.palletMotion.position.x>-STREAM_CONFIG.palletExchangeDistance)return;
      this.palletMotion.clear();
      this.items=this.items.filter(item=>item.state!=="departing");
      this.completedPallets++;this.palletNumber++;
      this.packer=new OnlinePacker(new Vector3(STREAM_CONFIG.palletWidth,STREAM_CONFIG.maxStackHeight,STREAM_CONFIG.palletDepth));
      this.diagnosticCandidates=[];this.diagnosticSelected=null;this.inspectedCandidates.clear();this.placedFootprints=[];
      this.diagnosticPhase="새 팔레트 준비";this.diagnosticReason="높이 지도 초기화";
      this.pallet=this.palletTemplate.clone(true);
      this.pallet.userData.collisionRole="pallet";
      this.pallet.scale.set(STREAM_CONFIG.palletWidth/PALLET_BASE_SIZE.x,STREAM_CONFIG.palletHeight/PALLET_BASE_SIZE.y,STREAM_CONFIG.palletDepth/PALLET_BASE_SIZE.z);
      this.pallet.position.copy(STREAM_CONFIG.center);
      this.palletMotion.add(this.pallet);
      this.exchange="incoming";
    }else{
      this.palletMotion.position.x=Math.min(0,this.palletMotion.position.x+step);
      if(this.palletMotion.position.x<0)return;
      this.root.attach(this.pallet);
      this.exchange=null;this.full=false;this.robotZ=0;this.lastSize="";
      for(const item of this.items)if(item.state==="moving")item.attempted=false;
    }
  }
  private pass(item: Item) {
    if (item.state === "passed") return;
    item.state = "passed";
    this.root.remove(item.node);
    this.passed++;
  }
  private reserve(item: Item, placement: Placement, alternatives: Placement[]) {
    this.busy = true;
    this.full = false;
    item.state = "reserved";
    this.lastSize = item.size.toArray().join("×") + "m";
    this.diagnosticCandidates=alternatives.map((p,rank)=>({...p,rank:rank+1,state:"pending",reason:"",phase:""}));
    this.inspectedCandidates.clear();
    const selectDiagnostic=(p:Placement)=>{
      let candidate=this.diagnosticCandidates.find(c=>candidateKey(c)===candidateKey(p));
      if(!candidate){candidate={...p,rank:this.diagnosticCandidates.length+1,state:"pending",reason:"",phase:""};this.diagnosticCandidates.push(candidate);}
      this.diagnosticSelected=candidate;this.diagnosticPhase="후보 선택";
      this.diagnosticReason=`우선순위 ${candidate.rank} · 바닥 ${p.bottom}m · 접근 깊이 ${p.x*this.packer.cell+p.width}m`;
    };
    selectDiagnostic(placement);
    const placementKey=(p:Placement)=>`${p.x}:${p.z}:${p.yaw}`;
    const attemptedPlacements = new Set([placementKey(placement)]);
    let placementLevel=placement.bottom;
    const accessDepth=(p:Placement)=>{
      const direction=STREAM_CONFIG.palletApproachDirection;
      return Math.max(p.x*this.packer.cell*direction.x,(p.x*this.packer.cell+p.width)*direction.x)
        +Math.max(p.z*this.packer.cell*direction.z,(p.z*this.packer.cell+p.depth)*direction.z);
    };
    let placementBand=accessDepth(placement);
    let usedRobotFallback=false;
    const selectPlacement=(next:Placement)=>{
      placement=next;job.yaw=next.yaw;
      selectDiagnostic(next);
      job.destination.copy(this.packer.position(next,STREAM_CONFIG.center,this.palletTop));
      attemptedPlacements.add(placementKey(next));return true;
    };
    const job: Transfer = {
      box: item.node,
      pickup: item.node.position.clone(),
      destination: this.packer.position(
        placement,
        STREAM_CONFIG.center,
        this.palletTop,
      ),
      moving: true,
      yaw: placement.yaw,
      velocity: new Vector3(),
      onPlanEvent:event=>{
        const candidate=this.diagnosticSelected;
        if(candidate){candidate.state=event.state;candidate.reason=event.reason;candidate.phase=event.phase;
          if(event.state!=="searching")this.inspectedCandidates.add(candidateKey(candidate));}
        this.diagnosticPhase=event.phase==="quick"?"빠른 경로 검사":"정밀 경로 검사";
        this.diagnosticReason=event.reason;
      },
      replanPlacement: (restart=false) => {
        if(restart)attemptedPlacements.clear();
        // A rotated box at the same centre is a different candidate. Try
        // every supported footprint, preserving far-to-near priority.
        const next=alternatives.find(p=>p.bottom===placementLevel&&accessDepth(p)===placementBand&&!attemptedPlacements.has(placementKey(p)));
        if(!next)return false;
        return selectPlacement(next);
      },
      advancePlacementLevel:()=>{
        let next=alternatives.find(p=>p.bottom>placementLevel||(p.bottom===placementLevel&&accessDepth(p)>placementBand));
        if(!next&&!usedRobotFallback){
          usedRobotFallback=true;
          // Packing feasibility is not robot feasibility. Only after all
          // gap-free candidates fail, allow a safe physical fallback.
          alternatives=this.packer.candidates(item.size,STREAM_CONFIG.palletApproachDirection,BOX_SIZES,true).filter(p=>p.preservesTiling===false);
          next=alternatives[0];
        }
        if(!next)return false;
        placementLevel=next.bottom;placementBand=accessDepth(next);attemptedPlacements.clear();return selectPlacement(next);
      },
      available: () =>
        item.state === "reserved" &&
        item.distance < this.length &&
        item.node.position.z < STREAM_CONFIG.pickupExpiryZ,
      onPick: () => {
        item.state = "held";
        item.node.userData.collisionRole="held";
      },
      onPlace: () => {
        this.packer.commit(placement);
        item.state = "placed";
        item.node.userData.collisionRole="placed";
        this.placedFootprints.push({...placement,id:this.placed});
        if(this.diagnosticSelected)this.diagnosticSelected.state="placed";
        this.diagnosticPhase="적재 완료";this.diagnosticReason="선택한 위치에 박스 적재 완료";
        this.busy = false;
        this.placed++;
        this.robotZ = job.destination.z;
      },
      onMiss: () => {
        this.diagnosticPhase="집기 범위 통과";this.diagnosticReason="선택한 박스가 범위를 벗어남";
        item.state = "moving";
        item.node.userData.collisionRole="conveyor";
        item.attempted = true;
        this.busy = false;
      },
    };
    this.jobs.push(job);
  }
  syncJobs() {
    for (const job of this.jobs)
      if (job.moving && job.box.parent === this.root) {
        job.pickup.copy(job.box.position);
        const item = this.items.find((i) => i.node === job.box);
        if (item)
          job
            .velocity!.copy(
              this.curve.getTangentAt(Math.min(1, item.distance / this.length)),
            )
            .multiplyScalar(STREAM_CONFIG.speed);
      }
  }
  get boxes() {
    return [...this.items
      .filter((item) => item.state !== "passed")
      .map((item) => item.node), this.pallet];
  }
  get stats(): StreamStats {
    return {
      spawned: this.spawned,
      placed: this.placed,
      passed: this.passed,
      live: this.items.filter(
        (i) => i.state === "moving" || i.state === "reserved",
      ).length,
      utilization: this.packer.utilization,
      full: this.full,
      size: this.lastSize,
      palletNumber:this.palletNumber,
      completedPallets:this.completedPallets,
      exchanging:this.exchange!==null,
    };
  }
  get diagnostics():PackingSnapshot {
    return {
      columns:this.packer.columns,rows:this.packer.rows,cell:this.packer.cell,heights:Array.from(this.packer.heights),
      palletNumber:this.palletNumber,completedPallets:this.completedPallets,
      capacityFill:this.packer.volume/(this.packer.size.x*this.packer.size.y*this.packer.size.z),
      floorFill:this.packer.heights.filter(h=>h>0).length/this.packer.heights.length,
      inspected:this.inspectedCandidates.size,candidateCount:this.diagnosticCandidates.length,
      selected:this.diagnosticSelected?{...this.diagnosticSelected}:null,
      candidates:this.diagnosticCandidates.map(c=>({...c})),boxes:this.placedFootprints.map(p=>({...p})),
      phase:this.diagnosticPhase,reason:this.diagnosticReason,exchanging:this.exchange!==null,
    };
  }
}
