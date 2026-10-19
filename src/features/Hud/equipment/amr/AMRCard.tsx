import AMRStatusBadge from "@/features/Hud/equipment/amr/AMRStatusBadge";
import EquipmentCard from "@/features/Hud/equipment/_components/EquipmentCard";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = { agent: EquipmentSnapshot["agents"][number] };

export default function AMRCard({ agent }: Props) {
  return (
    <EquipmentCard id={agent.id} name={agent.name}>
      <div className="flex items-center justify-between text-xs">
        <span>{agent.name}</span>
        <AMRStatusBadge state={agent.state} />
      </div>

      <p className="mt-2 text-[10px] text-slate-400">
        {agent.status}
      </p>

      <p className="mt-1 text-[10px] text-slate-500">
        {agent.target && `${agent.target} · `}출고{" "}
        {agent.completed}회
      </p>
    </EquipmentCard>
  );
}
