import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentChoiceSetting from "@/ui/Hud/equipment/details/_components/EquipmentChoiceSetting";
import EquipmentEnabledSetting from "@/ui/Hud/equipment/details/_components/EquipmentEnabledSetting";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import { useSceneStore } from "@/stores/useSceneStore";
import { RACK_CONFIG } from "@/constants/rack";
import RackSlotGrid from "@/ui/Hud/equipment/rack/RackSlotGrid";
import RackArraySection from "@/ui/Hud/equipment/rack/RackArraySection";

export default function RackDetails({ object }: EquipmentDetailProps) {
  const enabled = useSceneStore((state) => state.settings[object.id]?.enabled);
  const mobile = useSceneStore((state) => state.settings[object.id]?.rackType === "mobile");

  const status = (
    <Badge tone={enabled ? "idle" : "offline"}>{enabled ? "보관 대기" : "중지"}</Badge>
  );

  return (
    <EquipmentDetailLayout object={object} status={status} summary={
      <DetailRows rows={[
        { label: "용도", value: mobile ? "팔레트 순환 이동식 랙 (Rack_m)" : "AMR 팔레트 보관 랙" },
        { label: "보관 칸", value: mobile ? "2단" : `${RACK_CONFIG.slots.length}칸` },
        { label: "수신 상태", value: enabled ? "대기" : "중지" },
      ]} />
    } settings={
      <DetailSection title="랙 설정">
        <EquipmentChoiceSetting
          id={object.id}
          field="rackType"
          label="랙 종류"
          fallback="fixed"
          options={[
            { value: "fixed", label: "고정 랙 (Rack)" },
            { value: "mobile", label: "이동식 랙 (Rack_m, AGV 운반)" },
          ]}
        />
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
      <RackArraySection object={object} />
      <RackSlotGrid rackId={object.id} />
    </EquipmentDetailLayout>
  );
}
