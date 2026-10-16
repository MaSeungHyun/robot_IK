import { useShallow } from "zustand/react/shallow";
import { Boxes, CircleDot, Pause, Play, RotateCcw, Truck } from "lucide-react";
import { useSimulationStore } from "@/stores/useSimulationStore";
import Select from "@/components/Select";
import Button from "@/components/Button";
import type { DemoMode } from "@/types/simulation";
import type { RobotTransferMode } from "@/types/robot";
import { BOX_COUNT } from "@/demo/robot/RobotDemo";
import LayoutPanel from "@/features/Hud/customize/LayoutPanel";
import { useSceneStore } from "@/stores/useSceneStore";
import { PLAYBACK_SPEEDS } from "@/constants/playback";

const DEMOS: readonly {value:DemoMode;label:string}[]=[
  {value:"robot",label:`Robot · 박스 ${BOX_COUNT}개`},
  {value:"conveyor",label:"Conveyor · 팔레타이징"},
  {value:"amr",label:"AMR · 창고 이송"},
  {value:"customize",label:"Customize · 자유 배치"},
];
const TRANSFERS: readonly {value:RobotTransferMode;label:string}[]=[
  {value:"base",label:"베이스 회전"},{value:"shoulder",label:"후방 넘기기"},
];

export default function SimulationPanel() {
  const editing=useSceneStore(s=>s.editing);
  const state=useSimulationStore(useShallow(s=>({
    demoMode:s.demoMode,setDemoMode:s.setDemoMode,transferMode:s.transferMode,setTransferMode:s.setTransferMode,
    stats:s.stats,progress:s.progress,running:s.running,setRunning:s.setRunning,reset:s.reset,
    speed:s.speed,setSpeed:s.setSpeed,
  })));
  const {demoMode,stats,progress,running}=state;
  const batch=demoMode==="robot";
  const isEditing=demoMode==="customize"&&editing;
  const completed=batch?progress.count:stats.placed;
  return <aside aria-label="시뮬레이션 제어" className="simulation-panel absolute left-4 top-4 z-10 w-[304px] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-xl max-sm:left-3 max-sm:top-3 max-sm:w-[260px] max-sm:p-4 max-sm:max-h-[55vh] max-h-[calc(100%-2rem)]">
    <div className="mb-5 flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300"><Boxes size={20}/></span>
      <div><p className="text-[10px] font-semibold tracking-[.22em] text-sky-300">SMART FACTORY</p><h1 className="mt-0.5 text-base font-semibold tracking-tight text-white">시뮬레이션</h1></div>
      <span className={`ml-auto size-2 rounded-full ${running?"bg-emerald-400 shadow-[0_0_10px_#34d39966]":"bg-slate-500"}`}/>
    </div>
    <Select label="데모 선택" value={demoMode} options={DEMOS} onValueChange={state.setDemoMode}/>
    <div className="mt-4"><p className="mb-2 text-xs text-slate-400">전체 속도</p><Select label="전체 속도" value={String(state.speed)} options={PLAYBACK_SPEEDS.map(speed=>({value:String(speed),label:`${speed}×`}))} onValueChange={value=>state.setSpeed(Number(value))}/></div>
    {!isEditing&&<section className="my-5 rounded-xl border border-white/5 bg-white/[.025] p-3.5" aria-label="로봇 상태">
      <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-slate-400"><CircleDot size={13}/>{demoMode==="amr"?"AMR 상태":"로봇 상태"}</span><span className={running?"text-emerald-300":"text-slate-400"}>{running?"실행 중":"대기"}</span></div>
      <p className="mt-2 min-h-10 text-[13px] leading-5 text-slate-200">{progress.status}</p>
      <div className="mt-3 flex items-end justify-between border-t border-white/5 pt-3"><span className="text-xs text-slate-400">{demoMode==="amr"?"이송 완료":"적재 완료"}</span><span className="text-xl font-semibold tabular-nums text-white">{completed}<span className="ml-1 text-xs font-normal text-slate-500">{batch?`/ ${BOX_COUNT}`:"개"}</span></span></div>
    </section>}
    {!batch&&!isEditing&&<>
      <div className="grid grid-cols-3 gap-2">{[["생성",stats.spawned],["이동",stats.live],["통과",stats.passed]].map(([label,value])=><div key={label} className="rounded-xl bg-white/[.035] px-3 py-2.5"><p className="text-[11px] text-slate-400">{label}</p><p className="mt-1 text-lg font-medium tabular-nums text-slate-100">{value}</p></div>)}</div>
      <div className="my-3 flex items-center justify-between px-1 text-sm"><span className="flex items-center gap-2 text-slate-400"><Truck size={15}/>출고 개수</span><span className="font-medium tabular-nums text-slate-100">{stats.completedPallets??0}<span className="ml-1 text-xs text-slate-500">개</span></span></div>
    </>}
    {demoMode!=="amr"&&!isEditing&&<div className="mt-5"><p className="mb-2 text-xs text-slate-400">이송 방식</p><Select label="이송 방식" value={state.transferMode} options={TRANSFERS} onValueChange={state.setTransferMode}/></div>}
    {demoMode==="customize"&&<LayoutPanel/>}
    {!isEditing&&<div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
      <Button disabled={demoMode==="customize"&&editing} onClick={()=>state.setRunning(value=>!value)}>{running?<Pause size={15}/>:<Play size={15}/>} {running?"일시 정지":"시작"}</Button>
      <Button secondary onClick={()=>state.reset()} aria-label="초기화"><RotateCcw size={15}/>초기화</Button>
    </div>}
  </aside>;
}
