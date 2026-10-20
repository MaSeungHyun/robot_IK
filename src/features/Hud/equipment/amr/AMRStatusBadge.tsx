import Badge from "@/components/Badge";
import Icon from "@/components/Icon";
import { AGENT_LABELS } from "@/features/Hud/equipment/amr/constants";
import { AGENT_TONES } from "@/features/Hud/equipment/equipmentStatus";
import type { EquipmentSnapshot } from "@/types/simulation";

type AgentState = EquipmentSnapshot["agents"][number]["state"];

export default function AMRStatusBadge({ state }: { state: AgentState }) {
  return (
    <Badge tone={AGENT_TONES[state]} className="gap-0.5">
      {state === "charging" && <Icon icon="Zap" aria-hidden="true" className="size-2.5" />}
      {AGENT_LABELS[state]}
    </Badge>
  );
}