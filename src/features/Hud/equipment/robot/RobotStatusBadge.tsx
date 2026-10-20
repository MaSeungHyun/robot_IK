import Badge from "@/components/Badge";
import { ROBOT_STATUSES } from "@/features/Hud/equipment/equipmentStatus";
import type { EquipmentSnapshot } from "@/types/simulation";

type RobotState = EquipmentSnapshot["robots"][number]["state"];

export default function RobotStatusBadge({ state }: { state: RobotState }) {
  const { label, tone } = ROBOT_STATUSES[state];

  return <Badge tone={tone}>{label}</Badge>;
}