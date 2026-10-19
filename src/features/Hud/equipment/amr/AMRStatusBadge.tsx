import Badge from "@/components/Badge";
import type { BadgeTone } from "@/components/Badge";
import { AGENT_LABELS } from "@/features/Hud/equipment/amr/constants";
import type { EquipmentSnapshot } from "@/types/simulation";

type AgentState = EquipmentSnapshot["agents"][number]["state"];

const STATUS_TONES = {
  idle: "idle",
  pickup: "operating",
  loading: "operating",
  dispatch: "operating",
  unloading: "operating",
  returning: "operating",
  blocked: "warning",
  waiting: "warning",
  yielding: "warning",
  disabled: "offline",
} satisfies Record<AgentState, BadgeTone>;

export default function AMRStatusBadge({ state }: { state: AgentState }) {
  return <Badge tone={STATUS_TONES[state]}>{AGENT_LABELS[state]}</Badge>;
}
