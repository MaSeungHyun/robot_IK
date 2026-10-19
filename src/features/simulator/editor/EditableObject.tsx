import EquipmentModel from "@/features/simulator/editor/EquipmentModel";
import { memo } from "react";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import EditableEquipment from "@/features/simulator/editor/EditableEquipment";
import { useSceneStore } from "@/stores/useSceneStore";
import RobotRange from "@/features/simulator/RobotRange";

type Props = { id: string; overlapping: boolean };

const EditableObject = memo(function EditableObject({ id, overlapping }: Props) {
  const object = useSceneStore((state) => state.objects.find((object) => object.id === id));
  const reach = useSceneStore((state) => state.settings[id]?.reach ?? SIMULATOR_CONFIG.reach);

  if (!object) return null;

  return (
    <EditableEquipment entity={object}>
      <EquipmentModel object={object} />

      {object.kind === "robot" && (
        <RobotRange reach={reach} overlapping={overlapping} />
      )}
    </EditableEquipment>
  );
});

export default EditableObject;
