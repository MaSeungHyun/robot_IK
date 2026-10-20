import AMRCard from "@/features/Hud/equipment/amr/AMRCard";
import { Truck } from "lucide-react";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = {
  agents: EquipmentSnapshot["agents"];
};

export default function AMRStatusSection({ agents }: Props) {
  return (
    <section aria-label="AMR 상태">
      <h3 className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
        <Truck size={14} />
        AMR · {agents.length}대
      </h3>
      {!agents.length && (
        <p className="text-[11px] text-text-secondary">
          배치된 AMR이 없습니다.
        </p>
      )}
      <div className="space-y-2">
        {agents.map((agent) => (
          <AMRCard key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  );
}
