import { Bot,Boxes,Truck,Package,MapPin } from "lucide-react";
import { useSceneStore,EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import type { EquipmentKind } from "@/types/layout";
import { cn } from "@/lib/style";
import { useRef } from "react";

const ASSETS=[{kind:"robot",icon:Bot},{kind:"pallet",icon:Package},{kind:"conveyor",icon:Boxes},{kind:"amr",icon:Truck},{kind:"dock",icon:MapPin}] as const;
export default function AssetPalettePanel(){
  const dragImage=useRef<HTMLCanvasElement>(null);
  const editing=useSceneStore(s=>s.editing),pending=useSceneStore(s=>s.pending),objects=useSceneStore(s=>s.objects),setPending=useSceneStore(s=>s.setPending);
  if(!editing)return null;
  return <div aria-label="에셋 라이브러리" className="simulation-panel absolute bottom-4 left-4 z-10 max-h-[42vh] w-[304px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-xl backdrop-blur-xl max-sm:bottom-auto max-sm:top-[330px] max-sm:w-[210px] max-sm:max-h-[22vh]">
    <canvas ref={dragImage} width={1} height={1} aria-hidden className="pointer-events-none fixed -left-4 -top-4"/>
    <div className="mb-3 flex justify-between"><h2 className="text-sm font-semibold">에셋</h2><span className="text-[10px] text-slate-500">드래그하여 추가</span></div>
    <div className="grid grid-cols-2 gap-2">{ASSETS.map(({kind,icon:Icon})=><button key={kind} draggable aria-label={`${EQUIPMENT_NAMES[kind]} 에셋 추가`} onDragEnd={()=>setPending(null)} onDragStart={e=>{setPending(kind);if(dragImage.current)e.dataTransfer.setDragImage(dragImage.current,0,0);e.dataTransfer.setData("application/x-factory-equipment",kind);e.dataTransfer.effectAllowed="copy";}} onClick={()=>setPending(kind as EquipmentKind)} className={cn("flex cursor-grab items-center gap-2 rounded-xl border p-3 text-left text-xs active:cursor-grabbing",pending===kind?"border-sky-400 bg-sky-400/10 text-sky-200":"border-white/10 bg-white/5 text-slate-200")}><Icon size={17}/><span>{EQUIPMENT_NAMES[kind]}<span className="mt-1 block text-[9px] text-slate-500">{objects.filter(o=>o.kind===kind).length}개 배치됨</span></span></button>)}</div>
    <p className="mt-3 text-[10px] text-slate-500">{pending?`${EQUIPMENT_NAMES[pending]} 미리보기를 확인한 뒤 클릭하세요. Esc 취소`:"같은 에셋을 여러 번 추가할 수 있습니다."}</p>
  </div>;
}
