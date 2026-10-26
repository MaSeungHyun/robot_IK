import { useMemo } from "react";
import { useGLTF } from "@/lib/three/gltfLoader";
import { conveyorArrows, conveyorTemplate } from "@/objects/conveyor/conveyorTemplate";
import { useInstanceModel } from "@/viewport/instancing/useInstanceModel";
import { MODEL } from "@/viewport/models/modelUrls";
import type { SceneEquipment } from "@/types/layout";
import { useSceneStore } from "@/stores/useSceneStore";

export default function ConveyorBelt({ entity }: { entity: SceneEquipment }) {
  const turn = entity.conveyorTurn;
  const { scene: rail } = useGLTF(MODEL.rail);
  const role = useSceneStore((state) => state.settings[entity.id]?.conveyorRole ?? "box");
  const model = useMemo(() => conveyorTemplate(turn, rail, role).clone(true), [turn, rail, role]);
  useInstanceModel(model, true);
  // Flow arrows: edit mode only (hidden while Play runs), separate from the instanced belt.
  const editing = useSceneStore((state) => state.editing);
  const arrows = useMemo(() => conveyorArrows(turn, role).clone(true), [turn, role]);
  return (
    <>
      <primitive object={model} dispose={null} />
      {editing && <primitive object={arrows} dispose={null} />}
    </>
  );
}