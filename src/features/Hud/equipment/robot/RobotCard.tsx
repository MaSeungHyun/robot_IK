import RobotStatusBadge from "@/features/Hud/equipment/robot/RobotStatusBadge";
import EquipmentCard from "@/features/Hud/equipment/_components/EquipmentCard";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = { robot: EquipmentSnapshot["robots"][number] };

export default function RobotCard({ robot }: Props) {
  return (
    <EquipmentCard id={robot.id} name={robot.name}>
      <div className="flex items-center justify-between text-xs">
        <span>{robot.name}</span>
        <RobotStatusBadge state={robot.state} />
      </div>

      <div className="mt-1 flex items-center justify-between gap-4 pr-1">
        <div
          role="progressbar"
          aria-label={`${robot.name} 가동률`}
          aria-valuenow={Math.round(robot.utilization)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="flex-1 my-2 h-1.5 overflow-hidden rounded-full bg-white/5"
        >
          <div
            className="h-full rounded-full bg-brand-secondary transition-[width]"
            style={{ width: `${robot.utilization}%` }}
          />
        </div>
        <span className="font-medium tabular-nums text-brand-secondary">
          {robot.utilization.toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-text-secondary">
        <span>처리 {robot.count}개</span>
      </div>

      <p
        className="mt-1 truncate text-[10px] text-text-secondary"
        title={robot.status}
      >
        {robot.status}
      </p>
    </EquipmentCard>
  );
}
