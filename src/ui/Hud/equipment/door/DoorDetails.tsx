import Badge from "@/components/Badge";
import { DOOR_CONFIG } from "@/constants/door";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";
import DetailSection from "@/ui/Hud/equipment/details/_components/DetailSection";
import EquipmentDetailLayout from "@/ui/Hud/equipment/details/_components/EquipmentDetailLayout";
import { DETAIL_INPUT_CLASS_NAME } from "@/ui/Hud/equipment/details/styles";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import DoorSettings from "@/ui/Hud/equipment/door/DoorSettings";
import { useSceneStore } from "@/stores/useSceneStore";

export default function DoorDetails({ object }: EquipmentDetailProps) {
  const config = useSceneStore((state) => state.settings[object.id]);
  const open = config?.doorOpen === true;
  const width = config?.doorWidth ?? DOOR_CONFIG.width, height = config?.doorHeight ?? DOOR_CONFIG.height;
  return (
    <EquipmentDetailLayout
      object={object}
      status={<Badge tone={open ? "operating" : "idle"}>{open ? "열림" : "닫힘"}</Badge>}
      summary={
        <DetailRows rows={[
          { label: "형식", value: "롤러 셔터" },
          { label: "개구부", value: `${width.toFixed(1)} × ${height.toFixed(1)} m` },
          { label: "상태", value: open ? "열림" : "닫힘" },
        ]} />
      }
      settings={
        <DetailSection title="문 설정">
          <DoorSettings id={object.id} inputClassName={DETAIL_INPUT_CLASS_NAME} />
        </DetailSection>
      }
    />
  );
}