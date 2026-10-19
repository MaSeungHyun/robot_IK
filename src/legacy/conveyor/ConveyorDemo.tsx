import type { StreamStats } from "@/types/conveyor";
import type { JointAngleRef, RobotTransferMode } from "@/types/robot";
import { PACKING, ROBOT_PICKING } from "@/constants/simulation";
import { useGLTF, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh, GridHelper } from "three";
import Robot from "@/features/Viewport/models/Robot";
import { ConveyorSimulator, STREAM_CONFIG } from "@/legacy/conveyor/ConveyorSimulator";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import type { PackingSnapshot } from "@/utils/packing/packingDiagnostics";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { simulationDelta } from "@/utils/simulation/simulationTime";

export default function ConveyorDemo({running,onProgress,onStats,onDiagnostics,jointAnglesRef,transferMode}:{transferMode?:RobotTransferMode;jointAnglesRef?:JointAngleRef;running:boolean;onProgress:(n:number,s:string)=>void;onStats:(stats:StreamStats)=>void;onDiagnostics:(snapshot:PackingSnapshot)=>void}){
  const speed=useSimulationStore(state=>state.speed);
  const box=useGLTF(boxUrl),pallet=useGLTF(palletUrl);
  const scene=useMemo(()=>new ConveyorSimulator(box.scene,pallet.scene),[box.scene,pallet.scene]);
  const runtime=useRef(scene),jobs=useRef(scene.jobs),report=useRef(0);
  const nextStackPoint=useRef<Mesh>(null);
  const palletGrid=useRef<GridHelper>(null);
  const exchangeStatus=useRef(scene.exchange);
  useFrame((_,delta)=>{
    if(!running)return;
    const dt=simulationDelta(delta,speed);runtime.current.advance(dt);runtime.current.syncJobs();
    if(palletGrid.current)palletGrid.current.visible=!scene.exchange;
    if(exchangeStatus.current!==scene.exchange){
      exchangeStatus.current=scene.exchange;
      onProgress(scene.placed,scene.exchange==="outgoing"?"적재된 팔레트 출고 중":scene.exchange==="incoming"?"새 팔레트 준비 중":"새 팔레트 준비 완료");
    }
    const job=scene.jobs.at(-1);
    if(nextStackPoint.current){
      nextStackPoint.current.visible=scene.busy&&Boolean(job);
      if(job)nextStackPoint.current.position.copy(job.destination);
    }
    report.current+=dt;if(report.current>=STREAM_CONFIG.statsInterval){onStats(runtime.current.stats);onDiagnostics(runtime.current.diagnostics);report.current=0;}
  },-2);
  return <>
    <primitive object={scene.root}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.004,0]}>
      <ringGeometry args={[ROBOT_PICKING.radius*STREAM_CONFIG.robotScale-0.006,ROBOT_PICKING.radius*STREAM_CONFIG.robotScale,96]}/>
      <meshBasicMaterial color="#3b82f6" transparent opacity={0.55} depthWrite={false}/>
    </mesh>
    <mesh ref={nextStackPoint} visible={false}>
      <sphereGeometry args={[0.018,12,12]}/><meshBasicMaterial color="#facc15" depthTest={false}/>
    </mesh>
    <gridHelper ref={palletGrid} args={[STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletWidth/PACKING.cell, "#fbbf24", "#94a3b8"]}
      position={[STREAM_CONFIG.center.x,scene.palletTop+STREAM_CONFIG.palletGridOffset,STREAM_CONFIG.center.z]}/>
    <Line points={scene.curve.getPoints(100)} color="#f59e0b" lineWidth={4}/>
    <mesh position={[1.06875,0.2375,0]}><boxGeometry args={[0.35,0.025,2.625]}/><meshStandardMaterial color="#475569"/></mesh>
    <mesh position={[0,0.003125,0]}><boxGeometry args={[0.1875,0.00625,1.75]}/><meshStandardMaterial color="#334155"/></mesh>
    <Robot transferMode={transferMode} jointAnglesRef={jointAnglesRef} jobs={jobs} geometryScale={STREAM_CONFIG.robotScale} running={running} onProgress={(_,status)=>onProgress(runtime.current.placed,status)}/>
  </>;
}

