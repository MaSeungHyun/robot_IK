import { ArrowLeft,Bot,Truck,Package } from "lucide-react";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { cn } from "@/lib/style";
import ObjectPropertiesPanel from "@/features/Hud/customize/ObjectPropertiesPanel";
import Button from "@/components/Button";

const AGENT_LABELS={idle:"대기",pickup:"픽업 이동",loading:"상차",dispatch:"출고 이동",unloading:"하차",returning:"복귀 이동",blocked:"경로 막힘",waiting:"경로 대기",yielding:"양보 대기",disabled:"중지"};
export default function EquipmentStatusPanel(){
  const equipment=useSimulationStore(state=>state.equipment),running=useSimulationStore(state=>state.running);
  const selected=useSceneStore(state=>state.selected),select=useSceneStore(state=>state.inspect);
  const inspected=useSceneStore(state=>state.inspected);
  const objects=useSceneStore(state=>state.objects),object=objects.find(object=>object.id===inspected);
  const robot=equipment?.robots.find(robot=>robot.id===inspected),agent=equipment?.agents.find(agent=>agent.id===inspected),pallet=equipment?.pallets.find(pallet=>pallet.id===inspected);
  return <aside aria-label="장비 현황" className="simulation-panel absolute right-4 top-4 z-20 max-h-[calc(100%-2rem)] w-[304px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-xl backdrop-blur-xl max-sm:bottom-3 max-sm:left-3 max-sm:right-3 max-sm:top-auto max-sm:max-h-[34vh] max-sm:w-auto">
    {inspected&&object?<>
      <Button secondary onClick={()=>select(null)} aria-label="장비 현황으로 돌아가기" className="mb-4 h-8 px-2 text-xs"><ArrowLeft size={14}/>뒤로 가기</Button>
      <h2 className="text-sm font-semibold">{object.name} · 장비 정보</h2>
      {(robot||agent||pallet)&&<div className="mt-3 rounded-xl border border-white/5 bg-white/[.025] p-3 text-xs text-slate-400">
        {robot&&<><p>{robot.status}</p><p className="mt-2">가동률 {robot.utilization.toFixed(0)}% · 처리 {robot.count}개</p></>}
        {agent&&<><p>{AGENT_LABELS[agent.state]} · {agent.status}</p><p className="mt-2">{agent.target&&`${agent.target} · `}출고 {agent.completed}회</p></>}
        {pallet&&<p>{pallet.shipping?"운반 대기 · 팔레트 교체 중":`적재 ${pallet.count} / ${pallet.capacity}`}</p>}
      </div>}
      <ObjectPropertiesPanel embedded/>
    </>:<>
    <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">장비 현황</h2><span className={cn("text-[10px]",running?"text-emerald-300":"text-slate-400")}>{running?"실행 중":"일시 정지"}</span></div>
    {!equipment?<p className="text-xs text-slate-400">장비 상태를 준비하고 있습니다.</p>:<>
      <section aria-label="로봇 가동률"><h3 className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Bot size={14}/>로봇 · {equipment.robots.length}대</h3>
        <div className="space-y-2">{equipment.robots.map(robot=><button key={robot.id} onClick={()=>select(robot.id)} className={cn("w-full rounded-xl border p-3 text-left",selected===robot.id?"border-sky-400/50 bg-sky-400/5":"border-white/5 bg-white/[.025]")}>
          <div className="flex items-center justify-between text-xs"><span>{robot.name}</span><span className="font-medium tabular-nums text-sky-300">{robot.utilization.toFixed(0)}%</span></div>
          <div role="progressbar" aria-label={`${robot.name} 가동률`} aria-valuenow={Math.round(robot.utilization)} aria-valuemin={0} aria-valuemax={100} className="my-2 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-sky-400 transition-[width]" style={{width:`${robot.utilization}%`}}/></div>
          <div className="flex justify-between text-[10px] text-slate-400"><span>{robot.state==="disabled"?"중지":robot.state==="working"?"작업 중":"대기"}</span><span>처리 {robot.count}개</span></div>
          <p className="mt-1 truncate text-[10px] text-slate-500" title={robot.status}>{robot.status}</p>
        </button>)}</div>
      </section>
      <section aria-label="AMR 상태" className="mt-4"><h3 className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Truck size={14}/>AMR · {equipment.agents.length}대</h3>
        {!equipment.agents.length&&<p className="text-[11px] text-slate-500">배치된 AMR이 없습니다.</p>}
        <div className="space-y-2">{equipment.agents.map(agent=><button key={agent.id} onClick={()=>select(agent.id)} className={cn("w-full rounded-xl border p-3 text-left",selected===agent.id?"border-sky-400/50 bg-sky-400/5":"border-white/5 bg-white/[.025]")}>
          <div className="flex items-center justify-between text-xs"><span>{agent.name}</span><span className={cn("text-[10px]",agent.state==="idle"?"text-slate-400":agent.state==="waiting"||agent.state==="yielding"||agent.state==="blocked"?"text-amber-300":"text-emerald-300")}>{AGENT_LABELS[agent.state]}</span></div>
          <p className="mt-2 text-[10px] text-slate-400">{agent.status}</p><p className="mt-1 text-[10px] text-slate-500">{agent.target&&`${agent.target} · `}출고 {agent.completed}회</p>
        </button>)}</div>
      </section>
      <section aria-label="팔레트 적재 상태" className="mt-4"><h3 className="mb-2 flex items-center gap-2 text-xs text-slate-400"><Package size={14}/>팔레트 · {equipment.pallets.length}개</h3>
        {equipment.pallets.map(pallet=><button key={pallet.id} onClick={()=>select(pallet.id)} className="flex w-full justify-between rounded-lg px-2 py-2 text-[11px] hover:bg-white/5"><span className="text-slate-400">{pallet.name}</span><span className={pallet.shipping?"text-emerald-300":"text-slate-200"}>{pallet.shipping?"운반 중":`${pallet.count} / ${pallet.capacity}`}</span></button>)}
      </section>
      <section aria-label="기타 장비" className="mt-4"><h3 className="mb-2 text-xs text-slate-400">컨베이어 · 출고 구역</h3>
        {objects.filter(object=>object.kind==="conveyor"||object.kind==="dock").map(object=><button key={object.id} onClick={()=>select(object.id)} className="flex w-full justify-between rounded-lg px-2 py-2 text-[11px] hover:bg-white/5"><span className="text-slate-400">{object.name}</span><span className="text-slate-500">설정 →</span></button>)}
      </section>
    </>}
    </>}
  </aside>;
}
