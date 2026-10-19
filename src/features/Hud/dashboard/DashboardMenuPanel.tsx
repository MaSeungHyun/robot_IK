import Panel from "@/features/Hud/_components/Panel";
import SimulationStatsPanel from "@/features/Hud/simulation/SimulationStatsPanel";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";

export default function DashboardMenuPanel() {
  const count = useSceneStore((state) => state.objects.length);
  const running = useSimulationStore((state) => state.running);
  return (
    <Panel aria-label="대시보드" className="h-full flex-1">
      <h2 className="text-sm font-semibold">대시보드</h2>
      <p className="my-3 text-xs text-text-secondary">설비 {count}개 · {running ? "실행 중" : "일시 정지"}</p>
      <SimulationStatsPanel />
    </Panel>
  );
}
