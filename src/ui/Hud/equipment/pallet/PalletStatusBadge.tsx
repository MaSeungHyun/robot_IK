import Badge from "@/components/Badge";
import { palletStatus } from "@/ui/Hud/equipment/equipmentStatus";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = Pick<
  EquipmentSnapshot["pallets"][number],
  "shipping" | "count" | "capacity"
>;

export default function PalletStatusBadge(props: Props) {
  const { label, tone } = palletStatus(props);
  return <Badge tone={tone}>{label}</Badge>;
}