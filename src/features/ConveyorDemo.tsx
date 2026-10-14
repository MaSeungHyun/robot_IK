import { MOTION, PACKING } from "./constants";
import { useGLTF, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, GridHelper } from "three";
import Robot from "./Robot";
import { ConveyorWorld, STREAM_CONFIG, type StreamStats } from "./conveyor";
import boxUrl from "@/assets/models/box.glb?url";
import palletUrl from "@/assets/models/pallet.glb?url";
import type { PackingSnapshot } from "./packingDiagnostics";

export default function ConveyorDemo({running,onProgress,onStats,onDiagnostics}:{running:boolean;onProgress:(n:number,s:string)=>void;onStats:(stats:StreamStats)=>void;onDiagnostics:(snapshot:PackingSnapshot)=>void}){
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
    <mesh position={[8.55,1.9,0]}><boxGeometry args={[2.8,0.2,21]}/><meshStandardMaterial color="#475569"/></mesh>
    <mesh position={[0,0.025,0]}><boxGeometry args={[1.5,0.05,14]}/><meshStandardMaterial color="#334155"/></mesh>
    <Robot jobs={jobs} obstacles={obstacles} geometryScale={STREAM_CONFIG.robotScale} running={running} onProgress={(_,status)=>onProgress(runtime.current.placed,status)}/>
  </>;
}

