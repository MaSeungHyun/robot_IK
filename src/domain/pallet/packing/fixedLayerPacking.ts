import { Vector3 } from "three";
import { PACKING } from "@/constants/simulation";
import { OnlinePacker, type Placement } from "@/domain/pallet/packing/onlinePacking";

// A fixed footprint and fixed order: finish the entire lower layer first.
export class FixedLayerPacker extends OnlinePacker {
  readonly boxSize:Vector3;
  readonly slotsPerLayer:number;
  private readonly slots:{x:number;z:number}[];
  private cachedRevision=-1;
  private remaining:Placement[]=[];

  constructor(size:Vector3,boxSize:Vector3,palletCenter:Vector3,robotPosition=new Vector3()){
    super(size);
    this.boxSize=boxSize.clone();
    const w=Math.round(boxSize.x/this.cell),d=Math.round(boxSize.z/this.cell);
    if(w<=0||d<=0||Math.abs(w*this.cell-boxSize.x)>PACKING.epsilon||Math.abs(d*this.cell-boxSize.z)>PACKING.epsilon
      ||this.columns%w||this.rows%d)throw Error("Fixed box pattern must exactly fit the pallet grid");
    this.slots=[];
    for(let x=0;x<this.columns;x+=w)for(let z=0;z<this.rows;z+=d)this.slots.push({x,z});
    const distance=(p:{x:number;z:number})=>{
      const x=palletCenter.x-size.x/2+p.x*this.cell+boxSize.x/2-robotPosition.x;
      const z=palletCenter.z-size.z/2+p.z*this.cell+boxSize.z/2-robotPosition.z;
      return x*x+z*z;
    };
    this.slots.sort((a,b)=>distance(b)-distance(a)||a.x-b.x||a.z-b.z);
    this.slotsPerLayer=this.slots.length;
  }

  override candidates(size:Vector3):Placement[]{
    if(size.distanceTo(this.boxSize)>PACKING.epsilon)return [];
    if(this.cachedRevision!==this.revision){
      this.cachedRevision=this.revision;this.candidateEvaluations++;
      const layer=Math.floor(this.count/this.slotsPerLayer),next=this.count%this.slotsPerLayer;
      const bottom=layer*this.boxSize.y;
      this.remaining=bottom+this.boxSize.y>this.size.y+PACKING.epsilon?[]:
        this.slots.slice(next).map((slot,index)=>({...slot,width:this.boxSize.x,depth:this.boxSize.z,height:this.boxSize.y,
          bottom,yaw:0,revision:this.revision,preservesTiling:true,order:layer*this.slotsPerLayer+next+index+1}));
    }
    return this.remaining.slice();
  }

  override commit(placement:Placement){
    const next=this.candidates(this.boxSize)[0];
    if(!next||placement.x!==next.x||placement.z!==next.z||placement.yaw!==next.yaw
      ||Math.abs(placement.bottom-next.bottom)>PACKING.epsilon||Math.abs(placement.width-next.width)>PACKING.epsilon
      ||Math.abs(placement.depth-next.depth)>PACKING.epsilon||Math.abs(placement.height-next.height)>PACKING.epsilon)
      throw Error("Fixed layer packing cannot skip the next slot");
    super.commit(placement);
  }
}
