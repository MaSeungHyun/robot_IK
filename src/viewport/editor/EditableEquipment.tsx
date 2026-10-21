import { TransformControls } from "@react-three/drei";
import { useEffect, useState } from "react";
import type { Group } from "three";
import type { ReactNode } from "react";
import type { SceneEquipment } from "@/types/layout";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { isSelectionClick } from "@/viewport/selection/isSelectionClick";
import { editableGroups } from "@/viewport/editor/editableRegistry";
import { useModalTransformStore } from "@/stores/useModalTransformStore";
import { useLivePoseStore } from "@/stores/useLivePoseStore";

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
  const modal = useModalTransformStore((s) => s.session?.id === entity.id);
  useEffect(() => {
    if (!object) return;
    editableGroups.set(entity.id, object);
    return () => {
      if (editableGroups.get(entity.id) === object) editableGroups.delete(entity.id);
    };
  }, [entity.id, object]);
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
      {object && active && !modal && (
        <TransformControls
          object={object}
          mode={tool}
          translationSnap={SIMULATOR_CONFIG.snap}
          rotationSnap={Math.PI / 12}
          showX={tool === "translate"}
          showY={tool === "rotate"}
          showZ={tool === "translate"}
          size={0.75}
          onObjectChange={() => {
            if (entity.kind === "robot") useLivePoseStore.getState().set(entity.id, object.position.x, object.position.z);
          }}
          onMouseUp={() => {
            updatePose(entity.id, {
              x: object.position.x,
              z: object.position.z,
              yaw: object.rotation.y,
            });
            useLivePoseStore.getState().clear(entity.id);
          }}
        />
      )}
    </>
  );
}
