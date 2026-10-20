import type { ComponentType } from "react";
import RobotDetails from "@/features/Hud/equipment/robot/RobotDetails";
import AMRDetails from "@/features/Hud/equipment/amr/AMRDetails";
import PalletDetails from "@/features/Hud/equipment/pallet/PalletDetails";
import ConveyorDetails from "@/features/Hud/equipment/conveyor/ConveyorDetails";
import ScannerDetails from "@/features/Hud/equipment/scanner/ScannerDetails";
import DockDetails from "@/features/Hud/equipment/dock/DockDetails";
import FloorDetails from "@/features/Hud/equipment/floor/FloorDetails";
import type { EquipmentDetailProps } from "@/features/Hud/equipment/details/types";
import type { EquipmentKind } from "@/types/layout";

const DETAIL_COMPONENTS = {
  robot: RobotDetails,
  amr: AMRDetails,
  pallet: PalletDetails,
  conveyor: ConveyorDetails,
  scanner: ScannerDetails,
  dock: DockDetails,
  floor: FloorDetails,
} satisfies Record<EquipmentKind, ComponentType<EquipmentDetailProps>>;

export default function EquipmentDetails({ object }: EquipmentDetailProps) {
  const Detail = DETAIL_COMPONENTS[object.kind];

  return <Detail key={object.id} object={object} />;
}
