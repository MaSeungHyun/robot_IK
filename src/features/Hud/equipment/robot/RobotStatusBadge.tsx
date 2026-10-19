import Badge from "@/components/Badge";
import type { BadgeTone } from "@/components/Badge";
import type { EquipmentSnapshot } from "@/types/simulation";

type RobotState = EquipmentSnapshot["robots"][number]["state"];

const STATUSES = {
  working: { label: "작업 중", tone: "operating" },
  idle: { label: "대기", tone: "idle" },
  disabled: { label: "중지", tone: "offline" },
} satisfies Record<RobotState, { label: string; tone: BadgeTone }>;

export default function RobotStatusBadge({ state }: { state: RobotState }) {
  const { label, tone } = STATUSES[state];

  return <Badge tone={tone}>{label}</Badge>;
}
