import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";

export default function DockDetails({ object }: EquipmentDetailProps) {
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);

  const status = (
    <Badge tone={enabled ? "idle" : "offline"}>{enabled ? "출고 대기" : "중지"}</Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "용도", value: "AMR 팔레트 출고 목적지" },
        { label: "수신 상태", value: enabled ? "대기" : "중지" },
        { label: "개별 출고량" },
      ]} />
    } settings={
      <DetailSection title="출고 구역 설정">
        <EquipmentChoiceSetting
          id={object.id}
          field="acceptGrade"
          label="수신 용도"
          fallback="any"
          options={[
            { value: "any", label: "전체" },
            { value: "normal", label: "정상품 적재 팔레트만" },
            { value: "defect", label: "불량품 적재 팔레트만" },
          ]}
        />
        <EquipmentEnabledSetting id={object.id} />
      </DetailSection>
    }>

    </EquipmentDetailLayout>
  );
}
