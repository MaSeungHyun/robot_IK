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
  const emptyLinks = useSceneStore((state) => state.links.filter((l) => l.type === "emptyReturn" && l.to === id).length);
  // 담당 팔레트 only matters for a legacy forklift without a task (the task decides otherwise).
  const legacy = useSceneStore((state) => !state.settings[id]?.forkliftTask);
  const rackLinks = useSceneStore((state) => state.links.filter((l) => l.type === "store" && l.from === id).length);
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
        info={"빈 팔레트 회수: 로봇이 다 내린 AMR 위 빈 팔레트를 들어 적치장에 쌓습니다.\n🔗 연결 모드에서 AMR과 이 지게차를 이으면 '빈 팔레트 회수' 연결이 생기고, 연결된 지게차만 그 AMR의 빈 팔레트를 가져갑니다. 연결이 없으면(자동 연결) 경로상 가장 가까운 지게차가 갑니다."}
        options={[
          { value: "auto", label: "자동 (모든 작업)" },
          { value: "unload", label: "만재 팔레트 전담 (만재 → Rack_m·랙)" },
          { value: "supply", label: "빈 팔레트 전담 (적치장 ↔ AMR 공급·회수)" },
        ]}
      />}
      <p className="text-xs text-slate-500">빈 팔레트 회수 연결: {emptyLinks ? `AMR ${emptyLinks}대` : "없음 (가장 가까운 지게차 자동 배정)"}</p>
      <p className="text-xs text-slate-500">담당 랙 연결: {rackLinks ? `랙 ${rackLinks}개 (연결된 랙만 적재)` : "없음 (경로상 가장 가까운 적재 사용 랙)"}</p>
      <EquipmentNumberSetting id={id} field="amrSpeed" label="최대 주행 속도" unit="m/s" {...SPEED_LIMITS.amrSpeed} />
      <StopPointSetting id={id} roles={["service", "stage"]} />
      <EquipmentEnabledSetting id={id} />
    </DetailSection>
  );
}
