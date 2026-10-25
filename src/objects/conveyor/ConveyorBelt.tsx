import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { MODEL } from "@/viewport/models/modelUrls";
import type { SceneEquipment } from "@/types/layout";
import { useSceneStore } from "@/stores/useSceneStore";

export default function ConveyorBelt({ entity }: { entity: SceneEquipment }) {
  const turn = entity.conveyorTurn;
  const { scene: rail } = useGLTF(MODEL.rail);
  const role = useSceneStore((state) => state.settings[entity.id]?.conveyorRole ?? "box");
  const model = useMemo(() => conveyorTemplate(turn, rail, role).clone(true), [turn, rail, role]);
  useInstanceModel(model);
  return <primitive object={model} dispose={null} />;
}