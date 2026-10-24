import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { MODEL } from "@/viewport/models/modelUrls";
import type { SceneEquipment } from "@/types/layout";

export default function ConveyorBelt({ entity }: { entity: SceneEquipment }) {
  const turn = entity.conveyorTurn;
  const { scene: rail } = useGLTF(MODEL.rail);
  const model = useMemo(() => conveyorTemplate(turn, rail).clone(true), [turn, rail]);
  useInstanceModel(model);
  return <primitive object={model} dispose={null} />;
}