export type Cell = readonly [number,number];
export type NavigationGrid = {columns:number;rows:number;blocked:ReadonlySet<number>;canTraverse?:(from:Cell,to:Cell)=>boolean};

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
  const open=new Set(origins),cost=new Map(origins.map(id=>[id,0])),parents=new Map<number,number>();
  const estimate=(id:number)=>Math.min(...targets.map(goal=>{
    const dx=Math.abs(id%columns-goal[0]),dz=Math.abs(Math.floor(id/columns)-goal[1]);
    return Math.max(dx,dz)+(Math.SQRT2-1)*Math.min(dx,dz);
  }));
  while(open.size){
    let current=-1,score=Infinity;
    for(const id of open){const next=cost.get(id)!+estimate(id);if(next<score){score=next;current=id;}}
    if(destinations.has(current)){
      const path:Cell[]=[];
      for(let id:number|undefined=current;id!==undefined;id=parents.get(id))path.push([id%columns,Math.floor(id/columns)]);
      return path.reverse();
    }
    open.delete(current);
    const x=current%columns,z=Math.floor(current/columns);
    for(const [dx,dz] of DIRECTIONS){
      const nx=x+dx,nz=z+dz;
      if(nx<0||nz<0||nx>=columns||nz>=rows)continue;
      if(dx&&dz&&(blocked.has(z*columns+nx)||blocked.has(nz*columns+x)))continue;
      const id=nz*columns+nx,next=cost.get(current)!+(dx&&dz?Math.SQRT2:1);
      if(blocked.has(id)||next>=(cost.get(id)??Infinity))continue;
      if(grid.canTraverse&&!grid.canTraverse([x,z],[nx,nz]))continue;
      cost.set(id,next);parents.set(id,current);open.add(id);
    }
  }
  return null;
}
