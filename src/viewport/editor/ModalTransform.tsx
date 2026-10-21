import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { SIMULATOR_CONFIG as C } from "@/constants/simulatorLayout";
import { useModalTransformStore } from "@/stores/useModalTransformStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { editableGroups, lastPointer } from "@/viewport/editor/editableRegistry";
import { useLivePoseStore } from "@/stores/useLivePoseStore";

const ROTATION_STEP = Math.PI / 12; // same as the rotate gizmo's rotationSnap
const snap = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Drives an active G/R session: the object's group follows the cursor on the ground plane
 * (move, grid-snapped; Shift = free) or turns about Y towards it (rotate, 15° steps; Shift = free).
 * Left click confirms through updatePose (same snapping/undo as the gizmo); Esc / right click
 * restores the original pose (or removes a just-pasted copy). Camera controls are off meanwhile.
 */
export default function ModalTransform() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const get = useThree((state) => state.get);
  const session = useModalTransformStore((state) => state.session);

  // Track the pointer at all times so a session can start right under it.
  useEffect(() => {
    const element = gl.domElement;
    const move = (event: PointerEvent) => {
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      lastPointer.inside = true;
    };
    const leave = () => (lastPointer.inside = false);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, [gl]);

  useEffect(() => {
    if (!session) return;
    const group = editableGroups.get(session.id);
    if (!group) {
      useModalTransformStore.getState().end();
      return;
    }
    const element = gl.domElement;
    const ray = new Raycaster(), mouse = new Vector2(), plane = new Plane(new Vector3(0, 1, 0), 0), hit = new Vector3();
    const ground = (x: number, y: number) => {
      const bounds = element.getBoundingClientRect();
      mouse.set(((x - bounds.left) / bounds.width) * 2 - 1, -((y - bounds.top) / bounds.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
    };
    const { origin } = session;
    const robot = useSceneStore.getState().objects.find((object) => object.id === session.id)?.kind === "robot";
    const start = lastPointer.inside ? ground(lastPointer.x, lastPointer.y) : null;
    // Move keeps the grab offset (a pasted copy jumps under the cursor); rotate measures from the center.
    const offset = start && !session.created ? { x: origin.x - start.x, z: origin.z - start.z } : { x: 0, z: 0 };
    const startAngle = start ? Math.atan2(start.x - origin.x, start.z - origin.z) : 0;

    const apply = (event: PointerEvent | { clientX: number; clientY: number; shiftKey: boolean }) => {
      const point = ground(event.clientX, event.clientY);
      if (!point) return;
      if (session.mode === "move") {
        const x = point.x + offset.x, z = point.z + offset.z;
        group.position.set(event.shiftKey ? x : snap(x, C.snap), 0, event.shiftKey ? z : snap(z, C.snap));
        if (robot) useLivePoseStore.getState().set(session.id, group.position.x, group.position.z);
      } else {
        const delta = Math.atan2(point.x - origin.x, point.z - origin.z) - startAngle;
        const yaw = origin.yaw + delta;
        group.rotation.y = event.shiftKey ? yaw : snap(yaw, ROTATION_STEP);
      }
    };
    if (start) apply({ clientX: lastPointer.x, clientY: lastPointer.y, shiftKey: false });

    const restore = () => {
      group.position.set(origin.x, 0, origin.z);
      group.rotation.y = origin.yaw;
    };
    const finish = (confirm: boolean) => {
      useModalTransformStore.getState().end();
      const scene = useSceneStore.getState();
      if (confirm) {
        scene.updatePose(session.id, { x: group.position.x, z: group.position.z, yaw: group.rotation.y });
        return;
      }
      restore();
      if (session.created) {
        // Undo the paste itself and drop it from redo, as if it never happened.
        scene.undo();
        useSceneStore.setState((state) => ({ future: state.future.slice(1) }));
      }
    };
    const down = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Swallow the click that follows this pointerdown (no select/deselect/placement).
      const click = (next: MouseEvent) => {
        next.stopPropagation();
        window.removeEventListener("click", click, true);
      };
      window.addEventListener("click", click, true);
      window.setTimeout(() => window.removeEventListener("click", click, true), 1000);
      finish(event.button === 0);
    };
    const key = (event: KeyboardEvent) => {
      const switchTo = event.key.toLowerCase() === "r" ? "rotate" : event.key.toLowerCase() === "g" ? "move" : null;
      if (switchTo && switchTo !== session.mode && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // G <-> R: drop the uncommitted change and restart from the original pose in the other mode.
        event.preventDefault();
        event.stopPropagation();
        restore();
        useModalTransformStore.getState().begin({ ...session, mode: switchTo });
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
    };
    const menu = (event: MouseEvent) => event.preventDefault();
    const { controls: current, gl: renderer } = get();
    const controls = current as { enabled: boolean } | null;
    const canvas = renderer.domElement;
    const wasEnabled = controls?.enabled ?? true;
    if (controls) controls.enabled = false;
    const cursor = canvas.style.cursor;
    canvas.style.cursor = session.mode === "move" ? "move" : "grabbing";
    window.addEventListener("pointermove", apply);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    element.addEventListener("contextmenu", menu);
    return () => {
      window.removeEventListener("pointermove", apply);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      element.removeEventListener("contextmenu", menu);
      if (controls) controls.enabled = wasEnabled;
      useLivePoseStore.getState().clear(session.id);
      canvas.style.cursor = cursor;
    };
  }, [session, gl, camera, get]);

  // Leaving the editor ends any session.
  const editing = useSceneStore((state) => state.editing);
  useEffect(() => {
    if (!editing && useModalTransformStore.getState().session) useModalTransformStore.getState().end();
  }, [editing]);

  return null;
}
