import { PACKING } from "../../constants/simulation";

// Exact cover of a small integer grid. null means the work limit was reached;
// it must never be interpreted as proof that a placement is impossible.
export class LayerTiling {
  private readonly memo=new Map<string,boolean>();
  readonly columns:number;
  readonly rows:number;
  constructor(columns:number,rows:number){this.columns=columns;this.rows=rows;}
  canFill(mask:bigint,footprints:readonly (readonly [number,number])[]):boolean|null{
    const keyPrefix=footprints.map(s=>s.join(',')).join(';');
    let states=0;
    const visit=(remaining:bigint):boolean|null=>{
      if(remaining===0n)return true;
      const key=`${keyPrefix}|${remaining}`;
      const cached=this.memo.get(key);if(cached!==undefined)return cached;
      if(++states>PACKING.tilingSearchStates)return null;
      let first=0;while((remaining&(1n<<BigInt(first)))===0n)first++;
      const x=first%this.columns,z=Math.floor(first/this.columns);
      let unknown=false;
      for(const [width,depth] of footprints){
        if(x+width>this.columns||z+depth>this.rows)continue;
        let rectangle=0n;
        for(let dz=0;dz<depth;dz++)for(let dx=0;dx<width;dx++)rectangle|=1n<<BigInt((z+dz)*this.columns+x+dx);
        if((remaining&rectangle)!==rectangle)continue;
        const result=visit(remaining^rectangle);
        if(result===true){this.memo.set(key,true);return true;}
        if(result===null)unknown=true;
      }
      if(unknown)return null;
      this.memo.set(key,false);return false;
    };
    return visit(mask);
  }
}
