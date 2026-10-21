import Badge from "@/components/Badge";
import EquipmentCard from "@/ui/Hud/equipment/_components/EquipmentCard";
import {
  conveyorStatus,
  scannerStatus,
} from "@/ui/Hud/equipment/equipmentStatus";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import type { SceneEquipment } from "@/types/layout";

type Props = {
  objects: SceneEquipment[];
  title: string;
};

export default function StaticEquipmentSection({ objects, title }: Props) {
  const settings = useSceneStore((state) => state.settings);
  const running = useSimulationStore((state) => state.running);
  const scanners = useSimulationStore((state) => state.equipment?.scanners);

  if (!objects.length) return null;

  return (
    <section aria-label={title} className="mt-4">
      <h3 className="mb-2 text-xs text-text-secondary">
        {title} · {objects.length}개
      </h3>
      {objects.map((object) => {
        const enabled = settings[object.id]?.enabled;
        const scanner = scanners?.find((entry) => entry.id === object.id);
        const status =
          object.kind === "scanner"
            ? scannerStatus(enabled, scanner)
            : conveyorStatus(enabled, running);
        const metric =
          object.kind === "scanner"
            ? scanner && scanner.scanned > 0
              ? `검사 ${scanner.scanned}개 · 불량 ${((scanner.faults / scanner.scanned) * 100).toFixed(0)}%`
              : "검사 0개"
            : `속도 ×${settings[object.id]?.speed ?? 1}`;

        return (
          <EquipmentCard
            key={object.id}
            id={object.id}
            name={object.name}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-[11px] hover:bg-white/5"
          >
            <span className="min-w-0 truncate text-text-secondary">
              {object.name}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums text-text-secondary">{metric}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          </EquipmentCard>
        );
      })}
    </section>
  );
}
