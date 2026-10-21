import { useMemo } from "react";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import type { SceneEquipment } from "@/types/layout";

export default function ConveyorBelt({ entity }: { entity: SceneEquipment }) {
  const turn = entity.conveyorTurn;
  const model = useMemo(() => conveyorTemplate(turn).clone(true), [turn]);
  useInstanceModel(model);
  return <primitive object={model} dispose={null} />;
}
