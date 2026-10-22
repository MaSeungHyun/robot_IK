import Badge from "@/components/Badge";
import Icon from "@/components/Icon";
import { AGENT_LABELS } from "@/ui/Hud/equipment/amr/constants";
import { EQUIPMENT_STATES, LOW_BATTERY_PERCENT, agentState } from "@/ui/Hud/equipment/equipmentStatus";
import type { EquipmentSnapshot } from "@/types/simulation";

type AgentState = EquipmentSnapshot["agents"][number]["state"];

/** 5-state badge; the detailed AMR state is in the tooltip. */
export default function AMRStatusBadge({ state, battery }: { state: AgentState; battery?: number }) {
  const status = agentState({ state, battery: battery ?? Number.NaN });
  const { label, tone } = EQUIPMENT_STATES[status];
  const detail = status === "warning" ? `${AGENT_LABELS[state]} · 배터리 ${LOW_BATTERY_PERCENT}% 미만` : AGENT_LABELS[state];
  return (
    <Badge tone={tone} title={detail} className="gap-0.5">
      {state === "charging" && <Icon icon="Zap" aria-hidden="true" className="size-2.5" />}
      {label}
    </Badge>
  );
}