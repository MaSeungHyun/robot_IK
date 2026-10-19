import { Truck } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function SimulationStatsPanel() {
  const { spawned, live, passed, completedPallets } = useSimulationStore(useShallow(state => ({
    spawned: state.stats.spawned, live: state.stats.live, passed: state.stats.passed, completedPallets: state.stats.completedPallets ?? 0,
  })));
  return <>
    <div className="mt-2 grid grid-cols-3 gap-2">
      {[["생성", spawned], ["이동", live], ["통과", passed]].map(([label, value]) => <div key={label} className="rounded-xl bg-white/[.035] px-3 py-2.5">
        <p className="text-[11px] text-slate-400">{label}</p>
        <p className="mt-1 text-lg font-medium tabular-nums text-slate-100">{value}</p>
      </div>)}
    </div>
    <div className="my-3 flex items-center justify-between px-1 text-sm">
      <span className="flex items-center gap-2 text-slate-400"><Truck size={15} />출고 개수</span>
      <span className="font-medium tabular-nums text-slate-100">{completedPallets}<span className="ml-1 text-xs text-slate-500">개</span></span>
    </div>
  </>;
}
