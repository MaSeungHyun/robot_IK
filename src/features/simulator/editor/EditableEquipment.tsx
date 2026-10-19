import { TransformControls } from "@react-three/drei";
import { useState } from "react";
import type { Group } from "three";
import type { ReactNode } from "react";
import type { SceneEquipment } from "@/types/layout";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { isSelectionClick } from "@/utils/scene/isSelectionClick";

export default function EditableEquipment({
  entity,
  children,
}: {
  entity: SceneEquipment;
  children: ReactNode;
}) {
  const { active, editing, tool, updatePose, select } = useSceneStore(
    useShallow((s) => ({
      active: s.selected === entity.id && s.editing,
      editing: s.editing,
      tool: s.selected === entity.id ? s.tool : ("translate" as const),
      updatePose: s.updatePose,
      select: s.select,
    })),
  );
  const pose = entity;
  const [object, setObject] = useState<Group | null>(null);
  return (
    <>
      <group
        ref={setObject}
        userData={{ sceneId: entity.id }}
        position={[pose.x, 0, pose.z]}
        rotation={[0, pose.yaw, 0]}
        onClick={(event) => {
          if (isSelectionClick(event) && editing && !useSceneStore.getState().pending) {
            event.stopPropagation();
            select(entity.id);
          }
        }}
      >
        {children}
      </group>
      {object && active && (
        <TransformControls
          object={object}
          mode={tool}
          translationSnap={SIMULATOR_CONFIG.snap}
          rotationSnap={Math.PI / 12}
          showX={tool === "translate"}
          showY={tool === "rotate"}
          showZ={tool === "translate"}
          size={0.75}
          onMouseUp={() =>
            updatePose(entity.id, {
              x: object.position.x,
              z: object.position.z,
              yaw: object.rotation.y,
            })
          }
        />
      )}
    </>
  );
}
