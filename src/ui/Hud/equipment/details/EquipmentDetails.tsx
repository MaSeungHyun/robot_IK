import type { ComponentType } from "react";
import RobotDetails from "@/ui/Hud/equipment/robot/RobotDetails";
import AMRDetails from "@/ui/Hud/equipment/amr/AMRDetails";
import PalletDetails from "@/ui/Hud/equipment/pallet/PalletDetails";
import ConveyorDetails from "@/ui/Hud/equipment/conveyor/ConveyorDetails";
import ScannerDetails from "@/ui/Hud/equipment/scanner/ScannerDetails";
import DockDetails from "@/ui/Hud/equipment/dock/DockDetails";
import RackDetails from "@/ui/Hud/equipment/rack/RackDetails";
import FloorDetails from "@/ui/Hud/equipment/floor/FloorDetails";
import type { EquipmentDetailProps } from "@/ui/Hud/equipment/details/types";
import type { EquipmentKind } from "@/types/layout";

const DETAIL_COMPONENTS = {
  robot: RobotDetails,
  amr: AMRDetails,
  pallet: PalletDetails,
  conveyor: ConveyorDetails,
  scanner: ScannerDetails,
  dock: DockDetails,
  floor: FloorDetails,
  rack: RackDetails,
} satisfies Record<EquipmentKind, ComponentType<EquipmentDetailProps>>;

export default function EquipmentDetails({ object }: EquipmentDetailProps) {
  const Detail = DETAIL_COMPONENTS[object.kind];

  return <Detail key={object.id} object={object} />;
}
