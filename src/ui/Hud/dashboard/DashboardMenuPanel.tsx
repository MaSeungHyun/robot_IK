import Panel from "@/ui/Hud/_components/Panel";
import SimulationStatsPanel from "@/ui/Hud/simulation/SimulationStatsPanel";
import LineSummaryPanel from "@/ui/Hud/dashboard/LineSummaryPanel";
import KpiPanel from "@/ui/Hud/dashboard/KpiPanel";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useDashboardStore } from "@/stores/useDashboardStore";
import Button from "@/components/Button";

export default function DashboardMenuPanel() {
  const count = useSceneStore((state) => state.objects.length);
  const running = useSimulationStore((state) => state.running);
  return (
    <Panel aria-label="대시보드" className="h-full flex-1">
      <h2 className="text-sm font-semibold">대시보드</h2>
      <p className="my-3 text-xs text-text-secondary">설비 {count}개 · {running ? "실행 중" : "일시 정지"}</p>
      <SimulationStatsPanel />
      <LineSummaryPanel />
      <KpiPanel />
      <Button type="button" className="mt-3 h-7 w-full rounded-[3px] text-xs" onClick={() => useDashboardStore.getState().setOpen(true)}>
        전체 대시보드 열기
      </Button>
    </Panel>
  );
}
