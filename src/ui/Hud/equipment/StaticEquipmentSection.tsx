import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import Badge from "@/components/Badge";
import EquipmentCard from "@/ui/Hud/equipment/_components/EquipmentCard";
import {
  EQUIPMENT_STATES,
  conveyorState,
  scannerState,
} from "@/ui/Hud/equipment/equipmentStatus";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import type { SceneEquipment } from "@/types/layout";
import { beltSpeedOf, formatUnit } from "@/domain/simulation/equipmentSpeeds";

type Props = {
  objects: SceneEquipment[];
  title: string;
};

export default function StaticEquipmentSection({ objects, title }: Props) {
  if (!objects.length) return null;

  return (
    <section aria-label={title} className="mt-4">
      <h3 className="mb-2 text-xs text-text-secondary">
        {title} · {objects.length}개
      </h3>
      {objects.map((object) => (
        <StaticEquipmentItem key={object.id} object={object} />
      ))}
    </section>
  );
}

/** One row; subscribes only to its own settings and scanner snapshot. */
const StaticEquipmentItem = memo(function StaticEquipmentItem({
  object,
}: {
  object: SceneEquipment;
}) {
  const { enabled, speed } = useSceneStore(
    useShallow((state) => ({
      enabled: state.settings[object.id]?.enabled,
      speed: state.settings[object.id] ? beltSpeedOf(state.settings[object.id]) : undefined,
    })),
  );
  const running = useSimulationStore((state) => state.running);
  const scanner = useSimulationStore((state) =>
    object.kind === "scanner"
      ? state.equipment?.scanners?.find((entry) => entry.id === object.id)
      : undefined,
  );
  const status =
    EQUIPMENT_STATES[
      object.kind === "scanner"
        ? scannerState(enabled, scanner)
        : conveyorState(enabled, running)
    ];
  const detail =
    enabled === false
      ? "중지"
      : object.kind === "scanner"
        ? scanner?.lastResult === "fault"
          ? "불량 배출"
          : scanner?.lastResult === "safe"
            ? "통과"
            : "검사 대기"
        : running
          ? "이송 중"
          : "일시 정지";
  const metric =
    object.kind === "scanner"
      ? scanner && scanner.scanned > 0
        ? `검사 ${scanner.scanned}개 · 불량 ${((scanner.faults / scanner.scanned) * 100).toFixed(0)}%`
        : "검사 0개"
      : `속도 ${formatUnit(speed ?? 0)} m/s`;

  return (
    <EquipmentCard
      id={object.id}
      name={object.name}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-[11px] hover:bg-white/5"
    >
      <span className="min-w-0 truncate text-text-secondary">
        {object.name}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums text-text-secondary">{metric}</span>
        <Badge tone={status.tone} title={detail}>{status.label}</Badge>
      </span>
    </EquipmentCard>
  );
});
