import RobotStatusBadge from "@/features/Hud/equipment/robot/RobotStatusBadge";
import ProgressBar from "@/components/ProgressBar";
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

      <div className="mt-1 flex flex-col gap-1">
        <ProgressBar
          label={`${robot.name} 가동률`}
          caption="가동률"
          value={robot.utilization}
          className="mt-1 pr-1"
        />
        <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
          <span>처리 {robot.count}개</span>
        </div>
      </div>
      <p
        className="mt-2 truncate text-[10px] text-text-secondary"
        title={robot.status}
      >
        {robot.status}
      </p>
    </EquipmentCard>
  );
}
