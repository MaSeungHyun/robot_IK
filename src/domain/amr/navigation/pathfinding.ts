export type Cell = readonly [number,number];
export type NavigationGrid = {columns:number;rows:number;blocked:{has(id:number):boolean};canTraverse?:(from:Cell,to:Cell)=>boolean};

const DIRECTIONS:readonly Cell[]=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

/** Eight-neighbour A*: diagonal movement without cutting blocked corners. */
export function findPath(grid:NavigationGrid,start:Cell,goal:Cell): Cell[] | null {
  return findPathBetween(grid,[start],[goal]);
}

/** Multiple safe connectors avoid rejecting valid world positions between grid cells. */
export function findPathBetween(grid:NavigationGrid,starts:Cell[],goals:Cell[]):Cell[]|null{
  const {columns,rows,blocked}=grid;
  const inside=([x,z]:Cell)=>Number.isInteger(x)&&Number.isInteger(z)&&x>=0&&z>=0&&x<columns&&z<rows;
  const key=([x,z]:Cell)=>z*columns+x;
  const origins=starts.filter(cell=>inside(cell)&&!blocked.has(key(cell))).map(key);
  const targets=goals.filter(cell=>inside(cell)&&!blocked.has(key(cell)));
  if(!origins.length||!targets.length)return null;
  const destinations=new Set(targets.map(key));
  // Flat per-cell arrays (Infinity / -1 / 0 = unset): same search as the Map/Set version, without hashing.
  const cells=columns*rows,cost=new Float64Array(cells).fill(Infinity),parents=new Int32Array(cells).fill(-1),closed=new Uint8Array(cells);
  // Cached heuristic per cell (the min over targets used to be recomputed for every open cell every pop).
  const heuristic=new Float64Array(cells).fill(-1);
  const estimate=(id:number)=>{
    let h=heuristic[id];
    if(h<0){
      h=Infinity;const cx=id%columns,cz=Math.floor(id/columns);
      for(const goal of targets){const dx=Math.abs(cx-goal[0]),dz=Math.abs(cz-goal[1]);h=Math.min(h,Math.max(dx,dz)+(Math.SQRT2-1)*Math.min(dx,dz));}
      heuristic[id]=h;
    }
    return h;
  };
  // Binary min-heap ordered by f, then by the cell's first-open order (same tie-break as the old linear scan
  // over an insertion-ordered Set). Stale entries are skipped lazily. Was O(n^2) per search: an unreachable
  // goal on a large grid could take a full second inside one simulation step.
  const order=new Int32Array(cells).fill(-1);let seq=0;
  const heap:{f:number;o:number;id:number;g:number}[]=[];
  const less=(a:typeof heap[number],b:typeof heap[number])=>a.f<b.f||(a.f===b.f&&a.o<b.o);
  const push=(id:number,g:number)=>{
    let o=order[id];if(o<0){o=seq++;order[id]=o;}
    const item={f:g+estimate(id),o,id,g};heap.push(item);
    let i=heap.length-1;
    while(i>0){const up=(i-1)>>1;if(!less(heap[i],heap[up]))break;[heap[i],heap[up]]=[heap[up],heap[i]];i=up;}
  };
  const pop=()=>{
    const top=heap[0],last=heap.pop()!;
    if(heap.length){
      heap[0]=last;let i=0;
      for(;;){const l=2*i+1,r=l+1;let m=i;if(l<heap.length&&less(heap[l],heap[m]))m=l;if(r<heap.length&&less(heap[r],heap[m]))m=r;if(m===i)break;[heap[i],heap[m]]=[heap[m],heap[i]];i=m;}
    }
    return top;
  };
  for(const id of origins)if(cost[id]===Infinity){cost[id]=0;push(id,0);}
  while(heap.length){
    const item=pop(),current=item.id;
    if(closed[current]||item.g!==cost[current])continue;
    if(destinations.has(current)){
      const path:Cell[]=[];
      for(let id=current;id>=0;id=parents[id])path.push([id%columns,Math.floor(id/columns)]);
      return path.reverse();
    }
    closed[current]=1;
    const x=current%columns,z=Math.floor(current/columns);
    for(const [dx,dz] of DIRECTIONS){
      const nx=x+dx,nz=z+dz;
      if(nx<0||nz<0||nx>=columns||nz>=rows)continue;
      if(dx&&dz&&(blocked.has(z*columns+nx)||blocked.has(nz*columns+x)))continue;
      const id=nz*columns+nx,next=item.g+(dx&&dz?Math.SQRT2:1);
      if(blocked.has(id)||closed[id]||next>=cost[id])continue;
      if(grid.canTraverse&&!grid.canTraverse([x,z],[nx,nz]))continue;
      cost[id]=next;parents[id]=current;push(id,next);
    }
  }
  return null;
}
