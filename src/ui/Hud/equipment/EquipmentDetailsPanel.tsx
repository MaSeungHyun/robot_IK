import Panel from "@/ui/Hud/_components/Panel";
import EquipmentDetails from "@/ui/Hud/equipment/details/EquipmentDetails";
import ShipAmrDetails from "@/ui/Hud/equipment/amr/ShipAmrDetails";
import { isShipAmrId } from "@/domain/cycle/cycleStates";
import { useSceneStore } from "@/stores/useSceneStore";
import { useCargoStore } from "@/stores/useCargoStore";
import BoxDetails from "@/ui/Hud/cargo/BoxDetails";

export default function EquipmentDetailsPanel() {
  const objects = useSceneStore((state) => state.objects);
  const selected = useSceneStore((state) => state.inspected ?? state.selected);
  const boxId = useCargoStore((state) => state.selectedBoxId);
  const object = objects.find((candidate) => candidate.id === selected);
  const shipAmr = !object && selected != null && isShipAmrId(selected);
  return (
    <Panel
      aria-label="설비 상세"
      className="min-h-0 shrink overflow-hidden flex-1 h-full"
    >
      {/* Panel is bounded by the column; only this area scrolls. */}
      <div className="min-h-0 flex-auto overflow-y-auto -mr-4 pr-2.5 [scrollbar-gutter:stable] scrollbar-thin">
        {boxId ? (
          <BoxDetails id={boxId} />
        ) : object ? (
          <EquipmentDetails object={object} />
        ) : shipAmr && selected ? (
          <ShipAmrDetails id={selected} />
        ) : (
          <>
            <h2 className="text-sm font-semibold">Details</h2>
            <p className="mt-3 text-xs text-text-secondary">
              Scene 또는 Equipments에서 설비를 선택하세요.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
