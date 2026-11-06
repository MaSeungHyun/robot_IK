import { FORKLIFT_TASKS, FORKLIFT_TASK_LABELS } from "@/constants/forkliftTask";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import { SPEED_LIMITS } from "@/domain/simulation/equipmentSpeeds";
import { useSceneStore } from "@/stores/useSceneStore";
import StopPointSetting from "@/ui/Hud/equipment/details/_components/StopPointSetting";

/** Forklift-only settings (an AMR with amrRole "forklift"): shown instead of the AMR panel. */
export default function ForkliftSettings({ id }: { id: string }) {
  // 담당 팔레트 only matters for a legacy forklift without a task (the task decides otherwise).
  const legacy = useSceneStore((state) => !state.settings[id]?.forkliftTask);
  return (
    <DetailSection title="지게차 설정">
      <EquipmentChoiceSetting
        id={id}
        field="forkliftTask"
        label="지게차 작업"
        fallback="rack"
        options={FORKLIFT_TASKS.map((value) => ({ value, label: FORKLIFT_TASK_LABELS[value] }))}
      />
      {legacy && <EquipmentChoiceSetting
        id={id}
        field="forkliftRole"
        label="담당 팔레트"
        fallback="auto"
        info={"교체·회수: 연결된 AMR의 만재 교체와 빈 팔레트 회수를 담당합니다.\n🔗 연결 모드에서 AMR과 이 지게차를 이으면 '교체·회수' 연결이 생깁니다. 연결이 없으면(자동 연결) 같은 구역·가까운 지게차가 갑니다."}
        options={[
          { value: "auto", label: "자동 (모든 작업)" },
          { value: "unload", label: "만재 팔레트 전담 (만재 → Rack_m·랙)" },
          { value: "supply", label: "빈 팔레트 전담 (적치장 ↔ AMR 공급·회수)" },
        ]}
      />}
      <EquipmentNumberSetting id={id} field="amrSpeed" label="최대 주행 속도" unit="m/s" {...SPEED_LIMITS.amrSpeed} />
      <StopPointSetting id={id} roles={["service", "stage"]} />
      <EquipmentEnabledSetting id={id} />
    </DetailSection>
  );
}
