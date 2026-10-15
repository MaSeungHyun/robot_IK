import type { StreamStats } from "../../types/conveyor";
import type { JointAngleRef } from "../../types/robot";
import { MOTION, PACKING } from "../../constants/simulation";
import { useGLTF, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, GridHelper } from "three";
import Robot from "../Viewport/models/Robot";
import { ConveyorWorld, STREAM_CONFIG } from "../conveyor/conveyor";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import type { PackingSnapshot } from "../../utils/packing/packingDiagnostics";

export default function ConveyorDemo({running,onProgress,onStats,onDiagnostics,jointAnglesRef}:{jointAnglesRef?:JointAngleRef;running:boolean;onProgress:(n:number,s:string)=>void;onStats:(stats:StreamStats)=>void;onDiagnostics:(snapshot:PackingSnapshot)=>void}){
  const box=useGLTF(boxUrl),pallet=useGLTF(palletUrl);
  const scene=useMemo(()=>new ConveyorWorld(box.scene,pallet.scene),[box.scene,pallet.scene]);
  const runtime=useRef(scene),jobs=useRef(scene.jobs),obstacles=useRef<Group[]>(scene.boxes),report=useRef(0);
  const palletGrid=useRef<GridHelper>(null);
  const exchangeStatus=useRef(scene.exchange);
  useFrame((_,delta)=>{
    if(!running)return;
    const dt=Math.min(delta,MOTION.maxDelta);runtime.current.advance(dt);runtime.current.syncJobs();
    if(palletGrid.current)palletGrid.current.visible=!scene.exchange;
    if(exchangeStatus.current!==scene.exchange){
      exchangeStatus.current=scene.exchange;
      onProgress(scene.placed,scene.exchange==="outgoing"?"적재된 팔레트 출고 중":scene.exchange==="incoming"?"새 팔레트 준비 중":"새 팔레트 준비 완료");
    }
    obstacles.current=runtime.current.boxes;
    report.current+=dt;if(report.current>=STREAM_CONFIG.statsInterval){onStats(runtime.current.stats);onDiagnostics(runtime.current.diagnostics);report.current=0;}
  },-2);
  return <>
    <primitive object={scene.root}/>
    <gridHelper ref={palletGrid} args={[STREAM_CONFIG.palletWidth, STREAM_CONFIG.palletWidth/PACKING.cell, "#fbbf24", "#94a3b8"]}
      position={[STREAM_CONFIG.center.x,scene.palletTop+STREAM_CONFIG.palletGridOffset,STREAM_CONFIG.center.z]}/>
    <Line points={scene.curve.getPoints(100)} color="#f59e0b" lineWidth={4}/>
    <mesh position={[1.06875,0.2375,0]}><boxGeometry args={[0.35,0.025,2.625]}/><meshStandardMaterial color="#475569"/></mesh>
    <mesh position={[0,0.003125,0]}><boxGeometry args={[0.1875,0.00625,1.75]}/><meshStandardMaterial color="#334155"/></mesh>
    <Robot jointAnglesRef={jointAnglesRef} jobs={jobs} obstacles={obstacles} geometryScale={STREAM_CONFIG.robotScale} running={running} onProgress={(_,status)=>onProgress(runtime.current.placed,status)}/>
  </>;
}

