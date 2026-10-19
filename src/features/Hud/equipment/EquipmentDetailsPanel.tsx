import Panel from "@/features/Hud/_components/Panel";
import EquipmentDetails from "@/features/Hud/equipment/details/EquipmentDetails";
import { useSceneStore } from "@/stores/useSceneStore";

export default function EquipmentDetailsPanel() {
  const objects = useSceneStore((state) => state.objects);
  const selected = useSceneStore((state) => state.inspected ?? state.selected);
  const object = objects.find((candidate) => candidate.id === selected);
  return (
    <Panel aria-label="설비 상세">
      {object ? <EquipmentDetails object={object} /> : (
        <>
          <h2 className="text-sm font-semibold">Details</h2>
          <p className="mt-3 text-xs text-text-secondary">Scene 또는 Equipments에서 설비를 선택하세요.</p>
        </>
      )}
    </Panel>
  );
}
