import Panel from "@/features/Hud/_components/Panel";
import ScrollFade from "@/components/ScrollFade";
import EquipmentDetails from "@/features/Hud/equipment/details/EquipmentDetails";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EquipmentDetailsPanel() {
  const objects = useSceneStore((state) => state.objects);
  const selected = useSceneStore((state) => state.inspected ?? state.selected);
  const object = objects.find((candidate) => candidate.id === selected);
  return (
    <Panel
      aria-label="설비 상세"
      className="min-h-0 shrink overflow-hidden flex-1 h-full"
    >
      {/* Panel is bounded by the column; only this area scrolls. */}
      <ScrollFade className="-mr-2 min-h-0 flex-auto pr-2">
        {object ? (
          <EquipmentDetails object={object} />
        ) : (
          <>
            <h2 className="text-sm font-semibold">Details</h2>
            <p className="mt-3 text-xs text-text-secondary">
              Scene 또는 Equipments에서 설비를 선택하세요.
            </p>
          </>
        )}
      </ScrollFade>
    </Panel>
  );
}
