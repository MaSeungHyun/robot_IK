import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentNumberSetting from "@/ui/Hud/equipment/details/_components/EquipmentNumberSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
/** Placed docks are only 빈 팔레트 적치장 now (other roles are stop points of robots/forklifts/AMRs; legacy docks migrate on load). */
export default function DockDetails({ object }: EquipmentDetailProps) {
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);
  const legacyRole = useSceneStore((state) => { const role = state.settings[object.id]?.dockRole; return role && role !== "palletSource" ? role : null; });

  const status = (
    <Badge tone={enabled ? "idle" : "offline"}>{enabled ? "적치 대기" : "중지"}</Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "용도", value: legacyRole ? `이전 도크 (${legacyRole})` : "빈 팔레트 적치장" },
        { label: "수신 상태", value: enabled ? "대기" : "중지" },
      ]} />
    } settings={
      <DetailSection title="빈 팔레트 적치장 설정">
        {legacyRole && <p className="text-xs text-amber-400">하역·교체·출고 등 도크 역할은 로봇/지게차/AMR의 정차 위치로 옮겨졌습니다. 템플릿을 다시 불러오면 자동 변환됩니다.</p>}
        <EquipmentNumberSetting id={object.id} field="stackCapacity" label="적치 용량 (초과분은 반출)" unit="개" min={1} max={30} integer />
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}