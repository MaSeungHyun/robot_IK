import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Group, Intersection, Mesh } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { useFloorDrawingStore } from "@/stores/useFloorDrawingStore";
import {
  SIMULATOR_CONFIG as C,
  DEFAULT_LAYOUT,
  FLOOR_CONFIG,
} from "@/constants/simulatorLayout";
import type { FloorSize } from "@/types/layout";
import FloorRoom from "@/features/Viewport/models/FloorRoom";
import type { EquipmentKind } from "@/types/layout";
import { snapBelt } from "@/utils/conveyor/conveyorLayout";
import PlacementGhost from "./PlacementGhost";
import { isSelectionClick } from "@/utils/scene/isSelectionClick";

const KINDS: readonly EquipmentKind[] = [
  "robot",
  "pallet",
  "conveyor",
  "amr",
  "dock",
  "scanner",
];
const snap = (value: number) => Math.round(value / C.snap) * C.snap;
// Intersect the mathematical ground plane rather than a bounded mesh.
function groundRaycast(
  this: Mesh,
  raycaster: Raycaster,
  intersections: Intersection[],
) {
  const point = raycaster.ray.intersectPlane(
    new Plane(new Vector3(0, 1, 0), 0),
    new Vector3(),
  );
  if (!point) return;
  const distance = raycaster.ray.origin.distanceTo(point);
  if (distance >= raycaster.near && distance <= raycaster.far)
    intersections.push({ distance, point, object: this });
}
type FloorRect = { x: number; z: number; width: number; depth: number };
type FloorDraw = {
  phase: "idle" | "drag" | "height";
  start: { x: number; z: number };
  rect: FloorRect;
  height: number;
};
export default function PlacementFloor() {
  const { gl, camera } = useThree();
  const pending = useSceneStore((state) => state.pending);
  const ghost = useRef<Group>(null);
  // Swallows the click that follows confirming a floor, so it stays selected.
  const suppressClick = useRef(false);
  // Live floor/wall preview while drawing (center + size + wall height).
  const [floorPreview, setFloorPreview] = useState<(FloorRect & FloorSize) | null>(null);
  const projection = useMemo(
    () => ({
      ray: new Raycaster(),
      mouse: new Vector2(),
      plane: new Plane(new Vector3(0, 1, 0), 0),
      point: new Vector3(),
      wall: new Plane(),
      wallPoint: new Vector3(),
      draw: {
        phase: "idle",
        start: { x: 0, z: 0 },
        rect: { x: 0, z: 0, width: 1, depth: 1 },
        height: 0,
      } as FloorDraw,
    }),
    [],
  );
  useEffect(() => {
    const element = gl.domElement;
    const poseAt = (kind: EquipmentKind, x: number, z: number) => {
      const object = {
        ...DEFAULT_LAYOUT[kind],
        x: snap(x),
        z: snap(z),
        id: "placement-preview",
        name: "미리보기",
        kind,
      };
      return kind === "conveyor"
        ? snapBelt(object, useSceneStore.getState().objects)
        : object;
    };
    const pointAt = (event: MouseEvent) => {
      const bounds = element.getBoundingClientRect();
      projection.mouse.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      projection.ray.setFromCamera(projection.mouse, camera);
      return projection.ray.ray.intersectPlane(
        projection.plane,
        projection.point,
      );
    };
    const hide = () => {
      if (ghost.current) ghost.current.visible = false;
    };
    // ---- Floor/wall drawing: drag a grid rectangle, release, then set wall height.
    const draw = projection.draw;
    let navigating = false;
    const cellOf = (point: Vector3) => ({
      x: Math.floor(point.x / FLOOR_CONFIG.cell),
      z: Math.floor(point.z / FLOOR_CONFIG.cell),
    });
    const rectFrom = (a: { x: number; z: number }, b: { x: number; z: number }): FloorRect => {
      const cell = FLOOR_CONFIG.cell;
      const minX = Math.min(a.x, b.x) * cell, maxX = (Math.max(a.x, b.x) + 1) * cell;
      const minZ = Math.min(a.z, b.z) * cell, maxZ = (Math.max(a.z, b.z) + 1) * cell;
      return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
    };
    // Height = where the mouse ray meets a vertical plane through the floor center facing the camera.
    const heightAt = (event: MouseEvent) => {
      pointAt(event);
      const normal = camera.getWorldDirection(new Vector3()).setY(0);
      if (normal.lengthSq() < 1e-8) return draw.height;
      projection.wall.setFromNormalAndCoplanarPoint(normal.normalize(), new Vector3(draw.rect.x, 0, draw.rect.z));
      const hit = projection.ray.ray.intersectPlane(projection.wall, projection.wallPoint);
      if (!hit) return draw.height;
      const step = FLOOR_CONFIG.wallStep;
      return Math.min(FLOOR_CONFIG.maxWallHeight, Math.max(0, Math.round(hit.y / step) * step));
    };
    const resetDraw = () => {
      draw.phase = "idle";
      draw.height = 0;
      setFloorPreview(null);
      useFloorDrawingStore.getState().setDrawing(null);
    };
    const updatePreview = () => {
      setFloorPreview({ ...draw.rect, wallHeight: draw.height });
      if (draw.phase !== "idle") {
        useFloorDrawingStore.getState().setDrawing({
          phase: draw.phase,
          width: draw.rect.width,
          depth: draw.rect.depth,
          wallHeight: draw.height,
        });
      }
    };
    const unsubscribe = useSceneStore.subscribe((state) => {
      if ((state.pending !== "floor" || !state.editing) && draw.phase !== "idle") resetDraw();
    });
    const finishFloor = (wallHeight: number) => {
      const { rect } = draw;
      resetDraw();
      suppressClick.current = true;
      useSceneStore.getState().add("floor", {
        x: rect.x,
        z: rect.z,
        floor: { width: rect.width, depth: rect.depth, wallHeight },
      });
    };
    const floorDown = (event: PointerEvent) => {
      suppressClick.current = false;
      const state = useSceneStore.getState();
      if (state.pending !== "floor" || !state.editing) return;
      navigating = event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey;
      if (navigating) return;
      if (event.button !== 0 || draw.phase === "height") return;
      const point = pointAt(event);
      if (!point) return;
      hide();
      draw.phase = "drag";
      draw.start = cellOf(point);
      draw.rect = rectFrom(draw.start, draw.start);
      updatePreview();
    };
    const floorMove = (event: PointerEvent) => {
      // Camera navigation must not resize the footprint or change wall height.
      if (navigating || (event.buttons & 6)) return;
      if (draw.phase === "drag") {
        const point = pointAt(event);
        if (!point) return;
        draw.rect = rectFrom(draw.start, cellOf(point));
        updatePreview();
      } else if (draw.phase === "height") {
        draw.height = heightAt(event);
        updatePreview();
      }
    };
    const floorUp = (event: PointerEvent) => {
      if (navigating) {
        navigating = false;
        return;
      }
      if (event.button !== 0) return;
      if (draw.phase === "drag") {
        draw.phase = "height";
        draw.height = heightAt(event);
        updatePreview();
      } else if (draw.phase === "height") finishFloor(draw.height);
    };
    const floorMenu = (event: MouseEvent) => {
      if (draw.phase !== "idle") event.preventDefault();
    };
    const move = (event: MouseEvent) => {
      const kind = useSceneStore.getState().pending;
      if (!kind || !ghost.current || draw.phase !== "idle") {
        hide();
        return;
      }
      const point = pointAt(event);
      if (!point) {
        hide();
        return;
      }
      const pose =
        kind === "floor"
          ? { x: (Math.floor(point.x) + 0.5) * FLOOR_CONFIG.cell, z: (Math.floor(point.z) + 0.5) * FLOOR_CONFIG.cell, yaw: 0 }
          : poseAt(kind, point.x, point.z);
      ghost.current.position.set(pose.x, 0, pose.z);
      ghost.current.rotation.y = pose.yaw;
      ghost.current.visible = true;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (draw.phase === "height") finishFloor(0);
        else if (draw.phase === "drag") resetDraw();
        hide();
        useSceneStore.getState().setPending(null);
      }
    };
    const over = (event: DragEvent) => {
      if (
        event.dataTransfer?.types.includes("application/x-factory-equipment")
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        move(event);
      }
    };
    const drop = (event: DragEvent) => {
      const value = event.dataTransfer?.getData(
        "application/x-factory-equipment",
      ),
        kind = KINDS.find((kind) => kind === value);
      if (!kind || !useSceneStore.getState().editing) return;
      event.preventDefault();
      const point = pointAt(event);
      if (point)
        useSceneStore.getState().add(kind, poseAt(kind, point.x, point.z));
      hide();
    };
    element.addEventListener("pointerdown", floorDown, true);
    element.addEventListener("pointermove", floorMove);
    window.addEventListener("pointerup", floorUp);
    element.addEventListener("contextmenu", floorMenu);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", hide);
    element.addEventListener("dragleave", hide);
    window.addEventListener("keydown", escape);
    element.addEventListener("dragover", over);
    element.addEventListener("drop", drop);
    return () => {
      unsubscribe();
      useFloorDrawingStore.getState().setDrawing(null);
      element.removeEventListener("pointerdown", floorDown, true);
      element.removeEventListener("pointermove", floorMove);
      window.removeEventListener("pointerup", floorUp);
      element.removeEventListener("contextmenu", floorMenu);
      if (draw.phase !== "idle") resetDraw();
      element.removeEventListener("dragover", over);
      element.removeEventListener("drop", drop);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", hide);
      element.removeEventListener("dragleave", hide);
      window.removeEventListener("keydown", escape);
    };
  }, [gl, camera, projection]);
  return (
    <>
      {floorPreview && (
        <group position={[floorPreview.x, 0, floorPreview.z]}>
          <FloorRoom {...floorPreview} preview />
        </group>
      )}
      <group ref={ghost} visible={false}>
        {pending && (
          <Suspense fallback={null}>
            <PlacementGhost key={pending} kind={pending} />
          </Suspense>
        )}
      </group>
      <mesh
        raycast={groundRaycast}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.006, 0]}
        onClick={(event) => {
          const state = useSceneStore.getState();
          // Floor drawing owns its clicks (drag release / height confirm).
          if (suppressClick.current || state.pending === "floor") {
            suppressClick.current = false;
            event.stopPropagation();
            return;
          }
          if (!isSelectionClick(event)) return;
          if (state.pending && state.editing) {
            event.stopPropagation();
            state.add(state.pending, {
              x: snap(event.point.x),
              z: snap(event.point.z),
            });
          } else {
            event.stopPropagation();
            state.select(null);
          }
        }}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </>
  );
}
