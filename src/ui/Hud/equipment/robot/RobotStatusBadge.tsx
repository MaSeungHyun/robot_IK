import Badge from "@/components/Badge";
import { EQUIPMENT_STATES, robotState } from "@/ui/Hud/equipment/equipmentStatus";
import type { EquipmentSnapshot } from "@/types/simulation";

type RobotState = EquipmentSnapshot["robots"][number]["state"];

const DETAIL: Record<RobotState, string> = { working: "작업 중", idle: "박스 대기", disabled: "중지" };

/** 5-state badge; the detailed robot state is in the tooltip. */
export default function RobotStatusBadge({ state }: { state: RobotState }) {
  const { label, tone } = EQUIPMENT_STATES[robotState(state)];

  return <Badge tone={tone} title={DETAIL[state]}>{label}</Badge>;
}