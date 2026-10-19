import type { ComponentProps, ReactNode } from "react";
import { MapPin } from "lucide-react";
import Icon from "@/components/Icon";
import robotImage from "@/assets/images/robot.png";
import amrImage from "@/assets/images/amr.png";
import scannerImage from "@/assets/images/scanner.png";
import { EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import type { EquipmentKind, SceneEquipment } from "@/types/layout";
import { cn } from "@/lib/style";

type EquipmentVisual = {
  image?: string;
  icon: ComponentProps<typeof Icon>["icon"];
};
type Props = { object: SceneEquipment; status: ReactNode };

const EQUIPMENT_VISUALS: Record<EquipmentKind, EquipmentVisual> = {
  robot: { image: robotImage, icon: "Bot" },
  amr: { image: amrImage, icon: "Truck" },
  scanner: { image: scannerImage, icon: "ScanLine" },
  pallet: { icon: "Package" },
  conveyor: { icon: "Boxes" },
  dock: { icon: "MapPin" },
};

const cyberImageStageClass =
  "relative z-1 shrink-0 overflow-hidden bg-[radial-gradient(ellipse_85%_75%_at_50%_85%,rgba(0,120,200,0.28),transparent_70%)] [mask-image:radial-gradient(ellipse_96%_96%_at_50%_50%,#000_62%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_96%_96%_at_50%_50%,#000_62%,transparent_100%)] after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(to_top,rgba(2,8,18,0.55)_0%,transparent_45%)] after:content-['']";

export default function EquipmentIdentity({ object, status }: Props) {
  const visual = EQUIPMENT_VISUALS[object.kind];
  const metadata = object.metadata;

  return (
    <header className="flex min-w-0 items-start gap-3">
      <div
        className={cn(
          "equipment-image-grid flex h-36 w-28 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-brand-primary/20 p-1",
        )}
      >
        <div className={cn("absolute inset-0", cyberImageStageClass)} />
        {visual.image ? (
          <img
            src={visual.image}
            alt={`${EQUIPMENT_NAMES[object.kind]} 이미지`}
            className="h-full w-full object-contain"
          />
        ) : (
          <Icon
            icon={visual.icon}
            className="size-12 text-text-secondary"
            aria-label={`${EQUIPMENT_NAMES[object.kind]} 아이콘`}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <h2 className="break-words text-sm font-semibold text-text-primary">
          {object.name}
        </h2>
        <p
          className="mt-0.5 truncate text-[10px] text-text-secondary"
          title={metadata?.model}
        >
          {metadata?.model ?? EQUIPMENT_NAMES[object.kind]}
        </p>
        <p
          className="mt-1 truncate text-[10px] text-text-secondary"
          title={metadata?.serialNumber ?? object.id}
        >
          {metadata?.serialNumber
            ? `SN: ${metadata.serialNumber}`
            : `ID: ${object.id}`}
        </p>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-text-secondary">
          <MapPin size={10} className="shrink-0" />
          <span className="truncate" title={metadata?.location}>
            {metadata?.location ?? "위치 미등록"}
          </span>
        </p>
        <div className="mt-1.5">{status}</div>
      </div>
    </header>
  );
}
