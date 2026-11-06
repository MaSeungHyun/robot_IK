import type { ComponentProps, ReactNode } from "react";
import Icon from "@/components/Icon";
import robotImage from "@/assets/images/robot.png";
import amrImage from "@/assets/images/amr.png";
import scannerImage from "@/assets/images/scanner.png";
import palletImage from "@/assets/images/pallet.png";
import conveyorImage from "@/assets/images/rail.webp";
import rackImage from "@/assets/images/rack.webp";
import doorImage from "@/assets/images/door.webp";
import transferImage from "@/assets/images/transfer_forklift.webp";
import { equipmentDisplayKind, useSceneStore } from "@/stores/useSceneStore";
import { useThumbnailStore } from "@/stores/useThumbnailStore";
import { STATIC_THUMBNAILS, objectThumbnailKey } from "@/constants/assetPresets";
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
  conveyor: { image: conveyorImage, icon: "Boxes" },
  dock: { icon: "MapPin" },
  floor: { icon: "BrickWall" },
  rack: { image: rackImage, icon: "Warehouse" },
  door: { image: doorImage, icon: "DoorOpen" },
  rail: { image: conveyorImage, icon: "Boxes" },
  transfer: { image: transferImage, icon: "Package" },
};

export default function EquipmentIdentity({ object, status }: Props) {
  const visual = EQUIPMENT_VISUALS[object.kind];
  const metadata = object.metadata;
  const settings = useSceneStore((state) => state.settings[object.id]);
  const kindName = equipmentDisplayKind(object.kind, settings);
  // Rendered model thumbnail (same as the asset card); the static images/icons are the fallback.
  const key = useSceneStore((state) => objectThumbnailKey(object.kind, state.settings[object.id]));
  const thumbnail = useThumbnailStore((state) => (key ? state.thumbnails[key] : undefined));
  const image = (key ? STATIC_THUMBNAILS[key] : undefined) ?? thumbnail ?? visual.image;

  return (
    <header className="min-w-0">
      <h2
        className="truncate text-xs font-semibold text-text-primary"
        title={`${kindName} (${object.id})`}
      >
        {kindName}
        <span className="ml-1 font-normal text-text-secondary">{object.id}</span>
      </h2>

      <div className="pointer-events-none mt-4 flex h-45  items-center overflow-hidden bg-transparent">
        {image ? (
          <img
            src={image}
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
