import { TransformControls, useGLTF } from "@react-three/drei";
import { useMemo, useState } from "react";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { ReactNode } from "react";
import type { SceneEquipment } from "../../types/layout";
import { useSceneStore } from "../../stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { createUnitPallet } from "@/utils/three/modelNormalization";
import { STREAM_CONFIG } from "../../constants/simulation";
import { CUSTOMIZE_CONFIG } from "../../constants/customize";
import palletUrl from "@/assets/models/pallet.glb?url";
import robotUrl from "@/assets/models/robot.glb?url";
import { useInstanceModel } from "@/features/Viewport/instancing/useInstanceModel";

export { default as Belt } from "@/features/conveyor/ConveyorBelt";
const dockGeometry = new PlaneGeometry(1.3, 1.3);
const dockMaterial = new MeshBasicMaterial({
  color: "#075985",
  transparent: true,
  opacity: 0.75,
});
export function PalletPreview() {
  const { scene } = useGLTF(palletUrl);
  const model = useMemo(() => {
    const model = createUnitPallet(scene);
    model.scale.set(
      STREAM_CONFIG.palletWidth,
      STREAM_CONFIG.palletHeight,
      STREAM_CONFIG.palletDepth,
    );
    return model;
  }, [scene]);
  useInstanceModel(model);
  return <primitive object={model} />;
}
export function RobotPreview() {
  const { scene } = useGLTF(robotUrl);
  const model = useMemo(() => scene.clone(true), [scene]);
  useInstanceModel(model);
  return (
    <group scale={CUSTOMIZE_CONFIG.robotScale}>
      <primitive object={model} />
    </group>
  );
}
export function Dock() {
  const model = useMemo(() => {
    const group = new Group(),
      mesh = new Mesh(dockGeometry, dockMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.004;
    group.add(mesh);
    return group;
  }, []);
  useInstanceModel(model);
  return <primitive object={model} dispose={null} />;
}

export default function Equipment({
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
        onPointerDown={(event) => {
          if (editing && !useSceneStore.getState().pending) {
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
          translationSnap={CUSTOMIZE_CONFIG.snap}
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
