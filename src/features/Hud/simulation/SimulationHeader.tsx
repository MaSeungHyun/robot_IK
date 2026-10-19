import { Boxes } from "lucide-react";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function SimulationHeader() {
  const running = useSimulationStore(state => state.running);
  return <div className="mb-5 flex items-center gap-3">
    <span className="flex size-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300"><Boxes size={20} /></span>
    <div>
      <p className="text-[10px] font-semibold tracking-[.22em] text-sky-300">SMART FACTORY</p>
      <h1 className="mt-0.5 text-base font-semibold tracking-tight text-white">시뮬레이션</h1>
    </div>
    <span className={`ml-auto size-2 rounded-full ${running ? "bg-emerald-400 shadow-[0_0_10px_#34d39966]" : "bg-slate-500"}`} />
  </div>;
}
