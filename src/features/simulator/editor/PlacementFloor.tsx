import { Suspense, useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Group, Intersection, Mesh } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import {
  SIMULATOR_CONFIG as C,
  DEFAULT_LAYOUT,
} from "@/constants/simulatorLayout";
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
export default function PlacementFloor() {
  const { gl, camera } = useThree();
  const pending = useSceneStore((state) => state.pending);
  const ghost = useRef<Group>(null);
  const projection = useMemo(
    () => ({
      ray: new Raycaster(),
      mouse: new Vector2(),
      plane: new Plane(new Vector3(0, 1, 0), 0),
      point: new Vector3(),
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
    const move = (event: MouseEvent) => {
      const kind = useSceneStore.getState().pending;
      if (!kind || !ghost.current) {
        hide();
        return;
      }
      const point = pointAt(event);
      if (!point) {
        hide();
        return;
      }
      const pose = poseAt(kind, point.x, point.z);
      ghost.current.position.set(pose.x, 0, pose.z);
      ghost.current.rotation.y = pose.yaw;
      ghost.current.visible = true;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", hide);
    element.addEventListener("dragleave", hide);
    window.addEventListener("keydown", escape);
    element.addEventListener("dragover", over);
    element.addEventListener("drop", drop);
    return () => {
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
          if (!isSelectionClick(event)) return;
          const state = useSceneStore.getState();
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
