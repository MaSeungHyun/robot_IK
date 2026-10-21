import type { ComponentProps, ReactNode } from "react";
import Icon from "@/components/Icon";
import robotImage from "@/assets/images/robot.png";
import amrImage from "@/assets/images/amr.png";
import scannerImage from "@/assets/images/scanner.png";
import palletImage from "@/assets/images/pallet.png";
import { EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import type { EquipmentKind, SceneEquipment } from "@/types/layout";
import DetailRows from "@/ui/Hud/equipment/details/_components/DetailRows";

type EquipmentVisual = {
  image?: string;
  icon: ComponentProps<typeof Icon>["icon"];
};
type Props = { object: SceneEquipment; status: ReactNode };

const EQUIPMENT_VISUALS: Record<EquipmentKind, EquipmentVisual> = {
  robot: { image: robotImage, icon: "Bot" },
  amr: { image: amrImage, icon: "Truck" },
  scanner: { image: scannerImage, icon: "ScanLine" },
  pallet: { image: palletImage, icon: "Package" },
  conveyor: { icon: "Boxes" },
  dock: { icon: "MapPin" },
  floor: { icon: "BrickWall" },
  rack: { icon: "Warehouse" },
};

export default function EquipmentIdentity({ object, status }: Props) {
  const visual = EQUIPMENT_VISUALS[object.kind];
  const metadata = object.metadata;
  const kindName = EQUIPMENT_NAMES[object.kind];

  return (
    <header className="min-w-0">
      <h2 className="truncate text-xs font-semibold text-text-primary" title={object.name}>
        {object.name} <span className="text-text-secondary">· {kindName}</span>
      </h2>

      <div className="pointer-events-none mx-auto mt-2 flex h-28 w-36 items-center justify-center overflow-hidden rounded-[3px] border border-white/10 bg-black/20">
        {visual.image ? (
          <img
            src={visual.image}
            alt={`${kindName} 이미지`}
            className="h-full w-full object-contain"
          />
        ) : (
          <Icon
            icon={visual.icon}
            className="size-10 text-text-secondary"
            aria-label={`${kindName} 아이콘`}
          />
        )}
      </div>

      <div className="mt-2">
        <DetailRows
          rows={[
            { label: "모델", value: metadata?.model ?? kindName },
            metadata?.serialNumber
              ? { label: "SN", value: metadata.serialNumber }
              : { label: "ID", value: object.id },
            { label: "위치", value: metadata?.location ?? "위치 미등록" },
            { label: "상태", value: status },
          ]}
        />
      </div>
    </header>
  );
}
