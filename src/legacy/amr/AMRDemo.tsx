import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { Group } from "three";
import { AMR_CONFIG as C } from "@/constants/amr";
import { simulationDelta } from "@/utils/simulation/simulationTime";
import { AMRSimulator, cellPosition } from "@/legacy/amr/AMRSimulator";
import AMR from "@/features/Viewport/models/AMR";
import type { StreamStats } from "@/types/conveyor";
import { useSimulationStore } from "@/stores/useSimulationStore";

type Props={running:boolean;onStats:(stats:StreamStats)=>void;onProgress:(count:number,status:string)=>void};
export default function AMRDemo({running,onStats,onProgress}:Props){
  const speed=useSimulationStore(state=>state.speed);
  const simulation=useMemo(()=>new AMRSimulator(),[]);
  const body=useRef<Group>(null),cargo=useRef<Group>(null),report=useRef(0),phase=useRef("");
  const route=useMemo(()=>({
    get version(){return simulation.pathVersion;},
    get path(){return simulation.path.map(cell=>{const [x,,z]=cellPosition(cell);return new Vector3(x,0,z);});},
  }),[simulation]);
  useEffect(()=>{
    onStats(simulation.stats);onProgress(0,"다음 작업 대기");
  },[simulation,onStats,onProgress]);
  useFrame((_,delta)=>{
    if(!running)return;
    const dt=simulationDelta(delta,speed);
    simulation.advance(dt);
    if(body.current){body.current.position.set(simulation.x,0,simulation.z);body.current.rotation.y=simulation.yaw;}
    if(cargo.current)cargo.current.visible=simulation.carrying;
    if(phase.current!==simulation.phase){phase.current=simulation.phase;onProgress(simulation.completed,simulation.status);}
    report.current+=dt;
    if(report.current>=C.statsInterval){report.current=0;onStats(simulation.stats);}
  },-2);
  return <>
    <mesh position={[0,-.04,0]}><boxGeometry args={[C.columns*C.cellSize,.06,C.rows*C.cellSize]}/><meshStandardMaterial color="#17232e"/></mesh>
    {C.racks.map((cell,index)=>{
      const position=cellPosition(cell);
      return <group key={index} position={position}>
        <mesh position={[0,.72,0]}><boxGeometry args={[C.rackWidth,1.44,C.rackDepth]}/><meshStandardMaterial color="#35485a"/></mesh>
        {[.12,.72,1.32].map(y=><mesh key={y} position={[0,y,0]}><boxGeometry args={[1.06,.045,1.06]}/><meshStandardMaterial color="#6b8296"/></mesh>)}
        <mesh position={[0,1.6,0]}><boxGeometry args={[.65,.3,.65]}/><meshStandardMaterial color="#b89566"/></mesh>
      </group>;
    })}
    {C.pickups.map((cell,index)=><group key={index} position={cellPosition(cell)}>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,.005,0]}><ringGeometry args={[.3,.34,32]}/><meshBasicMaterial color="#fbbf24"/></mesh>
      <mesh position={[0,.2,0]}><boxGeometry args={[.35,.4,.35]}/><meshStandardMaterial color="#c6a477" transparent opacity={.5}/></mesh>
    </group>)}
    <mesh position={cellPosition(C.dispatch)} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[1.2,1.2]}/><meshBasicMaterial color="#0369a1"/></mesh>
    <group ref={body} position={cellPosition(C.start)}>
      <AMR route={route}/>
      <group ref={cargo} visible={false} position={[0,.48,0]}><mesh><boxGeometry args={[.4,.3,.4]}/><meshStandardMaterial color="#d4ae75"/></mesh></group>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,.015,0]}><ringGeometry args={[.38,.4,40]}/><meshBasicMaterial color="#38bdf8"/></mesh>
    </group>
  </>;
}
