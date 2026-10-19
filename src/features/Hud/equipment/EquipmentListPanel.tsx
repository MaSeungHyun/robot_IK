import Panel from "@/features/Hud/_components/Panel";
import EquipmentCard from "@/features/Hud/equipment/_components/EquipmentCard";
import { useSceneStore, EQUIPMENT_NAMES } from "@/stores/useSceneStore";

export default function EquipmentListPanel() {
  const objects = useSceneStore((state) => state.objects);
  return (
    <Panel
      aria-label="배치 장비 목록"
      className="rounded-2xl bg-slate-950/95 shadow-xl backdrop-blur-xl"
    >
      <h2 className="mb-3 text-sm font-semibold">
        장비 목록 · {objects.length}개
      </h2>
      {!objects.length && (
        <p className="text-xs text-slate-400">
          에셋 메뉴에서 장비를 배치하세요.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {objects.map((object) => (
          <EquipmentCard
            key={object.id}
            id={object.id}
            name={object.name}
            className="h-auto min-h-10 justify-between rounded-lg px-3 py-2 text-xs"
          >
            <span>{object.name}</span>
            <span className="text-[10px] text-slate-400">
              {EQUIPMENT_NAMES[object.kind]}
            </span>
          </EquipmentCard>
        ))}
      </div>
    </Panel>
  );
}
