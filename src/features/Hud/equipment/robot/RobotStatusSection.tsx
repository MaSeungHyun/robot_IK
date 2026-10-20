import RobotCard from "@/features/Hud/equipment/robot/RobotCard";
import { Bot } from "lucide-react";
import type { EquipmentSnapshot } from "@/types/simulation";

type Props = {
  robots: EquipmentSnapshot["robots"];
};

export default function RobotStatusSection({ robots }: Props) {
  return (
    <section aria-label="로봇 가동률">
      <h3 className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
        <Bot size={14} />
        로봇 · {robots.length}대
      </h3>
      <div className="flex flex-col gap-1">
        {robots.map((robot) => (
          <RobotCard key={robot.id} robot={robot} />
        ))}
      </div>
    </section>
  );
}
