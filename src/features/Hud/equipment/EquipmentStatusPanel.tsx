import Badge from "@/components/Badge";
import RobotStatusSection from "@/features/Hud/equipment/robot/RobotStatusSection";
import AMRStatusSection from "@/features/Hud/equipment/amr/AMRStatusSection";
import PalletStatusSection from "@/features/Hud/equipment/pallet/PalletStatusSection";
import StaticEquipmentSection from "@/features/Hud/equipment/StaticEquipmentSection";
import Panel from "@/features/Hud/_components/Panel";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EquipmentStatusPanel() {
  const equipment = useSimulationStore((state) => state.equipment);
  const running = useSimulationStore((state) => state.running);
  const objects = useSceneStore((state) => state.objects);


  return (
    <Panel
      aria-label="장비 현황"
      className="shadow-xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">장비 현황</h2>
        <Badge tone={running ? "operating" : "idle"}>
          {running ? "실행 중" : "일시 정지"}
        </Badge>
      </div>

      <p className="mb-3 text-[10px] text-text-secondary">클릭하여 선택 · 더블클릭하여 상세 정보</p>

      {!equipment ? (
        <p className="text-xs text-slate-400">
          장비 상태를 준비하고 있습니다.
        </p>
      ) : (
        <>
          <RobotStatusSection robots={equipment.robots} />

          <AMRStatusSection agents={equipment.agents} />

          <PalletStatusSection pallets={equipment.pallets} />

          <StaticEquipmentSection objects={objects} />
        </>
      )}
    </Panel>
  );
}
