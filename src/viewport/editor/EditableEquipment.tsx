import { TransformControls } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import type { Group } from "three";
import type { ReactNode } from "react";
import type { SceneEquipment } from "@/types/layout";
import { selectedIds, useSceneStore } from "@/stores/useSceneStore";
import { useShallow } from "zustand/react/shallow";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { isSelectionClick } from "@/viewport/selection/isSelectionClick";
import { editableGroups } from "@/viewport/editor/editableRegistry";
import { useModalTransformStore } from "@/stores/useModalTransformStore";
import { useLivePoseStore } from "@/stores/useLivePoseStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { pickLinkEnd } from "@/viewport/editor/links/pickLinkEnd";
import { LINKABLE_KINDS } from "@/types/links";
import DropInGroup from "@/viewport/editor/DropInGroup";

export default function EditableEquipment({
  entity,
  children,
}: {
  entity: SceneEquipment;
  children: ReactNode;
}) {
  const { active, editing, tool, updatePose, select } = useSceneStore(
    useShallow((s) => ({
      // Multi-select: GroupTransform owns the gizmo (pivot at the selection centre).
      active: s.selected === entity.id && s.editing && selectedIds(s).length < 2,
      editing: s.editing,
      tool: s.selected === entity.id ? s.tool : ("translate" as const),
      updatePose: s.updatePose,
      select: s.select,
    })),
  );
  const pose = entity;
  const [object, setObject] = useState<Group | null>(null);
  const modal = useModalTransformStore((s) => s.session?.id === entity.id);
  const linking = useLinkModeStore((s) => s.active);
  const gizmo = useRef<TransformControlsImpl>(null);
  const cancelled = useRef(false);
  const gizmoShown = !!object && active && !modal && !linking && tool !== "select";
  // Esc during a gizmo drag: put the object back and end the drag (dragging=false re-enables
  // the orbit controls through drei's dragging-changed listener).
  useEffect(() => {
    if (!gizmoShown) return;
    const key = (event: KeyboardEvent) => {
      // dragging/pointerUp are runtime-public but typed private in three-stdlib.
      const controls = gizmo.current as unknown as { dragging: boolean; reset: () => void; pointerUp: (pointer: { button: number }) => void } | null;
      if (event.key !== "Escape" || !controls?.dragging) return;
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      controls.reset();
      controls.pointerUp({ button: 0 });
      cancelled.current = false;
      useLivePoseStore.getState().clear(entity.id);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [gizmoShown, entity.id]);
  // A pallet mounted on an AMR rides its deck while the AMR is moved live (gizmo, modal G/R,
  // group transform): copy the carrier group's pose every frame unless the pallet itself is selected.
  const mountedOn = useSceneStore((s) => (entity.kind === "pallet" ? s.settings[entity.id]?.mountedOn : undefined));
  useFrame(() => {
    if (!object || !mountedOn) return;
    const carrier = editableGroups.get(mountedOn);
    if (!carrier) return;
    const scene = useSceneStore.getState();
    if (selectedIds(scene).includes(entity.id)) return;
    if (object.position.x === carrier.position.x && object.position.z === carrier.position.z && object.quaternion.equals(carrier.quaternion)) return;
    object.position.set(carrier.position.x, object.position.y, carrier.position.z);
    object.quaternion.copy(carrier.quaternion);
    object.updateMatrixWorld(true);
  }, -1);
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
          if (!isSelectionClick(event) || !editing || useSceneStore.getState().pending) return;
          if (useLinkModeStore.getState().active) {
            // Link mode: only linkable equipment takes the click (floors/walls let it through).
            if (!LINKABLE_KINDS.has(entity.kind)) return;
            event.stopPropagation();
            // A mounted pallet passes the click to its AMR (pickLinkEnd maps it).
            pickLinkEnd(entity.id);
            return;
          }
          {
            event.stopPropagation();
            const e = event.nativeEvent;
            if (e.shiftKey || e.ctrlKey || e.metaKey) useSceneStore.getState().toggleSelect(entity.id);
            else select(entity.id);
          }
        }}
      >
        <DropInGroup id={entity.id}>{children}</DropInGroup>
      </group>
      {object && gizmoShown && (
        <TransformControls
          ref={gizmo}
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
            if (cancelled.current) return;
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
