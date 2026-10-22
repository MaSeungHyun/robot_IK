import { TransformControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { selectedIds, useSceneStore } from "@/stores/useSceneStore";
import { useModalTransformStore } from "@/stores/useModalTransformStore";
import { useLinkModeStore } from "@/stores/useLinkModeStore";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import { editableGroups } from "@/viewport/editor/editableRegistry";

type Pose = { id: string; x: number; z: number; yaw: number };

/** Selected poses (store values) and their planar centroid. */
function capture(state = useSceneStore.getState()) {
  const poses: Pose[] = selectedIds(state).flatMap((id) => {
    const o = state.objects.find((object) => object.id === id);
    return o ? [{ id, x: o.x, z: o.z, yaw: o.yaw }] : [];
  });
  const cx = poses.reduce((sum, p) => sum + p.x, 0) / Math.max(1, poses.length);
  const cz = poses.reduce((sum, p) => sum + p.z, 0) / Math.max(1, poses.length);
  return { poses, cx, cz };
}

/**
 * Multi-select gizmo: a temporary pivot at the selection centroid. Move/rotate of the pivot is
 * applied mathematically (rigid transform about the centroid) to every selected pose, so it works
 * for instanced equipment too (their scene groups are previewed live; instances follow on sync).
 * Drag end commits all poses as one undo step; Esc during a drag restores them.
 */
export default function GroupTransform() {
  const { key, tool, editing } = useSceneStore(
    useShallow((s) => ({ key: s.editing ? selectedIds(s).join("|") : "", tool: s.tool, editing: s.editing })),
  );
  // Re-centre whenever a selected pose changes (after commit, undo, or a panel edit).
  const centre = useSceneStore((s) => {
    if (!key.includes("|")) return "";
    const { cx, cz } = capture(s);
    return `${cx},${cz}`;
  });
  const modal = useModalTransformStore((s) => s.session !== null);
  const linking = useLinkModeStore((s) => s.active);
  const pivot = useMemo(() => new Group(), []);
  const gizmo = useRef<TransformControlsImpl>(null);
  const start = useRef<ReturnType<typeof capture> | null>(null);
  const shown = editing && key.includes("|") && tool !== "select" && !modal && !linking;

  useLayoutEffect(() => {
    const [x, z] = centre ? centre.split(",").map(Number) : [0, 0];
    pivot.position.set(x, 0, z);
    pivot.rotation.set(0, 0, 0);
    pivot.updateMatrixWorld();
  }, [centre, pivot]);

  /** New pose of `p` for the current pivot offset/yaw relative to the drag start. */
  const transformed = (p: Pose, from: { cx: number; cz: number }) => {
    const yaw = pivot.rotation.y, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const rx = p.x - from.cx, rz = p.z - from.cz;
    // Rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos.
    return { x: pivot.position.x + rx * cos + rz * sin, z: pivot.position.z - rx * sin + rz * cos, yaw: p.yaw + yaw };
  };
  const preview = (restore = false) => {
    const from = start.current;
    if (!from) return;
    for (const p of from.poses) {
      const next = restore ? p : transformed(p, from);
      const group = editableGroups.get(p.id);
      if (group) { group.position.set(next.x, 0, next.z); group.rotation.set(0, next.yaw, 0); }
    }
  };

  useEffect(() => {
    if (!shown) return;
    const keydown = (event: KeyboardEvent) => {
      const controls = gizmo.current as unknown as { dragging: boolean; pointerUp: (pointer: { button: number }) => void } | null;
      if (event.key !== "Escape" || !controls?.dragging) return;
      event.preventDefault();
      event.stopPropagation();
      preview(true);
      const from = start.current;
      start.current = null;
      controls.pointerUp({ button: 0 });
      if (from) { pivot.position.set(from.cx, 0, from.cz); pivot.rotation.set(0, 0, 0); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
    // preview reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, pivot]);

  if (!shown) return null;
  return (
    <>
      <primitive object={pivot} />
      <TransformControls
        ref={gizmo}
        object={pivot}
        mode={tool}
        translationSnap={SIMULATOR_CONFIG.snap}
        rotationSnap={Math.PI / 12}
        showX={tool === "translate"}
        showY={tool === "rotate"}
        showZ={tool === "translate"}
        size={0.75}
        onMouseDown={() => { start.current = capture(); }}
        onObjectChange={() => preview()}
        onMouseUp={() => {
          const from = start.current;
          start.current = null;
          if (!from) return;
          useSceneStore.getState().updatePoses(from.poses.map((p) => ({ id: p.id, pose: transformed(p, from) })));
          // No change (click without drag): the centre selector will not fire, so reset here.
          pivot.rotation.set(0, 0, 0);
          const { cx, cz } = capture();
          pivot.position.set(cx, 0, cz);
        }}
      />
    </>
  );
}