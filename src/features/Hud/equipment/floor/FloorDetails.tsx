import DetailRows from "@/features/Hud/equipment/details/_components/DetailRows";
import Badge from "@/components/Badge";
import EquipmentDetailLayout from "@/features/Hud/equipment/details/_components/EquipmentDetailLayout";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";

export default function FloorDetails({ object }: EquipmentDetailProps) {
  const floor = object.floor ?? { width: 1, depth: 1, wallHeight: 0 };
  const status = <Badge tone="idle">{floor.wallHeight > 0 ? "벽 포함" : "바닥만"}</Badge>;

  return (
    <EquipmentDetailLayout
      object={object}
      status={status}
      summary={
        <DetailRows
          rows={[
            { label: "크기", value: `${floor.width} × ${floor.depth} m` },
            { label: "면적", value: `${floor.width * floor.depth} m²` },
            { label: "벽 높이", value: floor.wallHeight > 0 ? `${floor.wallHeight} m` : "없음" },
          ]}
        />
      }
    />
  );
}
