import EquipmentCard from "@/features/Hud/equipment/_components/EquipmentCard";
import type { SceneEquipment } from "@/types/layout";

type Props = {
  objects: SceneEquipment[];
};

export default function StaticEquipmentSection({ objects }: Props) {
  return (
    <section aria-label="기타 장비" className="mt-4">
      <h3 className="mb-2 text-xs text-slate-400">
        컨베이어 · 스캐너 · 출고 구역
      </h3>
      {objects
        .filter(
          (object) =>
            object.kind === "conveyor" || object.kind === "dock" || object.kind === "scanner",
        )
        .map((object) => (
          <EquipmentCard
            key={object.id}
            id={object.id}
            name={object.name}
            className="flex w-full justify-between rounded-md px-2 py-2 text-[11px] hover:bg-white/5"
          >
            <span className="text-slate-400">{object.name}</span>
            <span className="text-slate-500">더블클릭 →</span>
          </EquipmentCard>
        ))}
    </section>
  );
}
