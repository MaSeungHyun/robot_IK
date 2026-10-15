export type PieceType = { w:number; d:number; count:number };
export type Placed = { type:number; x:number; z:number; w:number; d:number };
type Options = { shuffle?:boolean; random?:()=>number };

// Inventory-aware exact cover: state includes occupancy AND remaining counts.
export function tile(W:number,H:number,types:readonly PieceType[],opts:Options={}):Placed[]|null {
  if(!Number.isInteger(W)||!Number.isInteger(H)||W<=0||H<=0)throw Error("Invalid tiling dimensions");
  for(const p of types)if(!Number.isInteger(p.w)||!Number.isInteger(p.d)||p.w<=0||p.d<=0
    ||!(p.count===Infinity||(Number.isInteger(p.count)&&p.count>=0)))throw Error("Invalid tile inventory");
  if(types.every(t=>Number.isFinite(t.count))&&types.reduce((s,t)=>s+t.w*t.d*t.count,0)!==W*H)return null;
  const counts=types.map(t=>t.count),dead=new Set<string>(),out:Placed[]=[];
  const full=(1n<<BigInt(W*H))-1n,random=opts.random??Math.random;
  const visit=(occupied:bigint):boolean=>{
    if(occupied===full)return true;
    const key=`${occupied}|${counts}`;if(dead.has(key))return false;
    let i=0;while((occupied&(1n<<BigInt(i)))!==0n)i++;
    const x=i%W,z=Math.floor(i/W),order=types.map((_,n)=>n);
    if(opts.shuffle)for(let n=order.length-1;n>0;n--){const j=Math.floor(random()*(n+1));[order[n],order[j]]=[order[j],order[n]];}
    for(const t of order){
      if(counts[t]<=0)continue;
      const p=types[t],orientations=p.w===p.d?[[p.w,p.d]]:[[p.w,p.d],[p.d,p.w]];
      for(const [w,d] of orientations){
        if(x+w>W||z+d>H)continue;
        let mask=0n;for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)mask|=1n<<BigInt((z+dz)*W+x+dx);
        if(occupied&mask)continue;
        counts[t]--;out.push({type:t,x,z,w,d});
        if(visit(occupied|mask))return true;
        out.pop();counts[t]++;
      }
    }
    dead.add(key);return false;
  };
  return visit(0n)?out:null;
}

export function randomPerfectSet(W:number,H:number,shapes:readonly (readonly [number,number])[],random:()=>number=Math.random):PieceType[]|null {
  const result=tile(W,H,shapes.map(([w,d])=>({w,d,count:Infinity})),{shuffle:true,random});
  if(!result)return null;
  const counts=shapes.map(()=>0);for(const p of result)counts[p.type]++;
  return shapes.map(([w,d],i)=>({w,d,count:counts[i]}));
}
