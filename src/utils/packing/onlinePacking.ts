import { PACKING } from "../../constants/simulation";
import { Vector3 } from "three";
import { LayerTiling } from "./tiling";

export type Placement = { x:number; z:number; width:number; depth:number; height:number; bottom:number; yaw:number; revision:number; preservesTiling?:boolean; order?:number };

// Online best-fit heightmap: full footprint support, no overlap/overhang.
// This is a heuristic for unknown future arrivals, not a global optimum.
export class OnlinePacker {
  readonly cell:number;
  readonly columns:number;
  readonly rows:number;
  readonly heights:Float64Array;
  revision=0;
  volume=0;
  count=0;
  readonly size:Vector3;
  private readonly candidateCache = new Map<string, Placement[]>();
  candidateEvaluations=0;
  private readonly tiling:LayerTiling;
  constructor(size:Vector3, cell=PACKING.cell) {
    if(size.toArray().some(v=>!Number.isFinite(v)||v<=0)||cell<=0)throw Error("Invalid pallet dimensions");
    this.size=size.clone();this.cell=cell;this.columns=Math.floor(size.x/cell+PACKING.epsilon);this.rows=Math.floor(size.z/cell+PACKING.epsilon);
    this.heights=new Float64Array(this.columns*this.rows);
    this.tiling=new LayerTiling(this.columns,this.rows);
  }
  candidates(size:Vector3, approachDirection?:Vector3, knownSizes?:readonly Vector3[], allowUntileable=false):Placement[] {
    if(size.toArray().some(v=>!Number.isFinite(v)||v<=0))throw Error("Invalid box dimensions");
    const key=`${size.toArray()}|${approachDirection?.toArray()}|${knownSizes?.map(s=>s.toArray().join(',')).join(';')}|${allowUntileable}`;
    const cached=this.candidateCache.get(key);if(cached)return cached.slice();
    this.candidateEvaluations++;
    const result:{placement:Placement;score:number[]}[]=[];
    const peak=Math.max(0,...this.heights);
    const completion=new Map<number,{mask:bigint;shapes:[number,number][];possible:boolean|null}>();
    const unitW=Math.round(size.x/this.cell),unitD=Math.round(size.z/this.cell);
    const uniformPattern=knownSizes?.length===1&&knownSizes[0].distanceTo(size)<PACKING.epsilon
      &&unitW>0&&unitD>0&&Math.abs(unitW*this.cell-size.x)<PACKING.epsilon&&Math.abs(unitD*this.cell-size.z)<PACKING.epsilon
      &&this.columns%unitW===0&&this.rows%unitD===0;
    for(const yaw of size.x===size.z?[0]:[0,Math.PI/2]) {
      const width=yaw?size.z:size.x,depth=yaw?size.x:size.z;
      const w=Math.ceil(width/this.cell-PACKING.epsilon),d=Math.ceil(depth/this.cell-PACKING.epsilon);
      if(uniformPattern&&(this.columns%w!==0||this.rows%d!==0))continue;
      for(let z=0;z+d<=this.rows;z+=uniformPattern?d:1)for(let x=0;x+w<=this.columns;x+=uniformPattern?w:1) {
        const bottom=this.heights[z*this.columns+x]; let flat=true,contact=0;
        for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)if(Math.abs(this.heights[(z+dz)*this.columns+x+dx]-bottom)>PACKING.supportTolerance)flat=false;
        if(!flat||bottom+size.y>this.size.y+PACKING.epsilon)continue;
        let preservesTiling=true;
        if(knownSizes?.length&&!uniformPattern){
          let layer=completion.get(bottom);
          if(!layer){
            let mask=0n;
            this.heights.forEach((height,i)=>{if(Math.abs(height-bottom)<PACKING.supportTolerance)mask|=1n<<BigInt(i);});
            const shapes:[number,number][]=[];
            for(const future of knownSizes){
              if(bottom+future.y>this.size.y+PACKING.epsilon)continue;
              const a=Math.ceil(future.x/this.cell-PACKING.epsilon),b=Math.ceil(future.z/this.cell-PACKING.epsilon);
              for(const shape of [[a,b],[b,a]] as [number,number][])
                if(!shapes.some(s=>s[0]===shape[0]&&s[1]===shape[1]))shapes.push(shape);
            }
            layer={mask,shapes,possible:this.tiling.canFill(mask,shapes)};completion.set(bottom,layer);
          }
          let footprint=0n;
          for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)footprint|=1n<<BigInt((z+dz)*this.columns+x+dx);
          // Preserve a complete tiling when it exists. If an older level
          // already has an unfillable gap, retain supported fallback options.
          preservesTiling=!(layer.possible===true&&this.tiling.canFill(layer.mask^footprint,layer.shapes)===false);
          if(!preservesTiling&&!allowUntileable)continue;
        }
        for(let dx=0;dx<w;dx++) {
          if(z===0||this.heights[(z-1)*this.columns+x+dx]>bottom)contact++;
          if(z+d===this.rows||this.heights[(z+d)*this.columns+x+dx]>bottom)contact++;
        }
        for(let dz=0;dz<d;dz++) {
          if(x===0||this.heights[(z+dz)*this.columns+x-1]>bottom)contact++;
          if(x+w===this.columns||this.heights[(z+dz)*this.columns+x+w]>bottom)contact++;
        }
        // Project the near face toward the robot, rather than using radial
        // distance: the fixed robot sits on +X; hand00 supplies lateral reach.
        const accessDepth=approachDirection
          ? Math.max(x*this.cell*approachDirection.x,(x*this.cell+width)*approachDirection.x)
            +Math.max(z*this.cell*approachDirection.z,(z*this.cell+depth)*approachDirection.z)
          : 0;
        let waste=0,roughness=0,barrier=0,imbalance=0;
        if(knownSizes?.length){
          const next=this.heights.slice();
          for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)next[(z+dz)*this.columns+x+dx]=bottom+size.y;
          const usable=new Uint8Array(next.length);
          for(const future of knownSizes)for(const rotate of future.x===future.z?[false]:[false,true]){
            const fw=Math.ceil((rotate?future.z:future.x)/this.cell-PACKING.epsilon),fd=Math.ceil((rotate?future.x:future.z)/this.cell-PACKING.epsilon);
            for(let fz=0;fz+fd<=this.rows;fz++)for(let fx=0;fx+fw<=this.columns;fx++){
              const level=next[fz*this.columns+fx];if(level+future.y>this.size.y+PACKING.epsilon)continue;
              let supported=true;
              for(let dz=0;dz<fd&&supported;dz++)for(let dx=0;dx<fw;dx++)if(Math.abs(next[(fz+dz)*this.columns+fx+dx]-level)>PACKING.supportTolerance){supported=false;break;}
              if(supported)for(let dz=0;dz<fd;dz++)for(let dx=0;dx<fw;dx++)usable[(fz+dz)*this.columns+fx+dx]=1;
            }
          }
          const mean=next.reduce((sum,h)=>sum+h,0)/next.length;
          for(let i=0;i<next.length;i++){
            if(next[i]<this.size.y&&!usable[i])waste++;
            roughness+=(next[i]-mean)**2;
            const row=Math.floor(i/this.columns),column=i%this.columns;
            imbalance+=next[i]*(row<this.rows/2?-1:1);
            if(approachDirection?.x&&column>0){
              const far=approachDirection.x>0?next[i-1]:next[i];
              const near=approachDirection.x>0?next[i]:next[i-1];
              barrier+=Math.max(0,near-far);
            }
          }
        }
        result.push({placement:{x,z,width,depth,height:size.y,bottom,yaw,revision:this.revision,preservesTiling},
          // Preserve the access corridor before optimizing compactness:
          // fill the far band of each supported level before the near band.
          score:[bottom,Math.max(peak,bottom+size.y),accessDepth,waste,roughness,barrier,-contact,Math.abs(imbalance),z,x]});
      }
    }
    result.sort((a,b)=>{for(let i=0;i<a.score.length;i++){const delta=a.score[i]-b.score[i];if(Math.abs(delta)>PACKING.epsilon)return delta;}return 0;});
    const placements=result.map(r=>r.placement);this.candidateCache.set(key,placements);return placements.slice();
  }
  reserve(size:Vector3) {return this.candidates(size)[0]??null;}
  commit(p:Placement) {
    if(p.revision!==this.revision)throw Error("Stale pallet reservation");
    const w=Math.ceil(p.width/this.cell-PACKING.epsilon),d=Math.ceil(p.depth/this.cell-PACKING.epsilon);
    if(!Number.isInteger(p.x)||!Number.isInteger(p.z)||p.x<0||p.z<0||p.x+w>this.columns||p.z+d>this.rows
      ||p.width<=0||p.depth<=0||p.height<=0||p.bottom<0||p.bottom+p.height>this.size.y+PACKING.epsilon)
      throw Error("Reservation outside pallet bounds");
    for(let z=p.z;z<p.z+d;z++)for(let x=p.x;x<p.x+w;x++)if(Math.abs(this.heights[z*this.columns+x]-p.bottom)>PACKING.supportTolerance)throw Error("Reservation no longer supported");
    for(let z=p.z;z<p.z+d;z++)for(let x=p.x;x<p.x+w;x++)this.heights[z*this.columns+x]=p.bottom+p.height;
    this.volume+=p.width*p.depth*p.height;this.count++;this.revision++;
    this.candidateCache.clear();
  }
  position(p:Placement, center:Vector3, top:number) {
    return new Vector3(center.x-this.columns*this.cell/2+p.x*this.cell+p.width/2,top+p.bottom+p.height,center.z-this.rows*this.cell/2+p.z*this.cell+p.depth/2);
  }
  get utilization(){const height=Math.max(0,...this.heights);return height?this.volume/(this.columns*this.cell*this.rows*this.cell*height):0;}
}
