import ProgressBar from "@/components/ProgressBar";
import AMRStatusBadge from "@/features/Hud/equipment/amr/AMRStatusBadge";
import EquipmentCard from "@/features/Hud/equipment/_components/EquipmentCard";
import { batteryTone } from "@/features/Hud/equipment/equipmentStatus";
import useEquipmentTelemetry from "@/hooks/useEquipmentTelemetry";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = { agent: EquipmentSnapshot["agents"][number] };

export default function AMRCard({ agent }: Props) {
  const battery =
    useEquipmentTelemetry(agent.id)?.batteryPercent ?? agent.battery;
  const charging = agent.state === "charging";

  return (
    <EquipmentCard id={agent.id} name={agent.name}>
      <div className="flex items-center justify-between text-xs">
        <span>{agent.name}</span>
        <AMRStatusBadge state={agent.state} />
      </div>

      {battery !== undefined && Number.isFinite(battery) ? (
        <ProgressBar
          label={`${agent.name} 배터리`}
          caption="배터리"
          value={battery}
          tone={charging ? "info" : batteryTone(battery)}
          pulse={charging}
          className="mt-2 pr-1"
        />
      ) : (
        <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
          <span className="w-10 shrink-0">배터리</span>
          <span title="배터리 데이터 미연결" className="text-offline">
            — 미연결
          </span>
        </div>
      )}

      <p className="mt-2 text-[10px] text-text-secondary">{agent.status}</p>

      <p className="mt-1 text-xs text-text-secondary">
        {agent.target && `${agent.target} · `}출고 {agent.completed}회
      </p>
    </EquipmentCard>
  );
}
