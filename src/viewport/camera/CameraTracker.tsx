import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Box3, Sphere, Vector3 } from "three";
import type { Object3D } from "three";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { SceneObjectResolver, setSceneRoot, worldYaw } from "@/viewport/scene/sceneObjects";

type ControlsEvent = "start" | "end";
type Controls = {
  target: Vector3;
  /** OrbitControls listens here (r3f's event source), which need not be the canvas. */
  domElement?: HTMLElement | null;
  enablePan?: boolean;
  minDistance: number;
  maxDistance: number;
  update: () => void;
  addEventListener: (type: ControlsEvent, listener: () => void) => void;
  removeEventListener: (type: ControlsEvent, listener: () => void) => void;
};

/** Height above the object's origin the camera looks at. */
const LOOK_HEIGHT = 0.45;
/** Robots are framed on this end-effector joint (follow-smoothed by FOLLOW_RATE); the ring stays at the base. */
const ROBOT_FOCUS_JOINT = "hand03";
/** Position follow stiffness (1/s). */
const FOLLOW_RATE = 8;
/** Heading follow stiffness (1/s): smooths in-place turns. */
const YAW_RATE = 3;
/** Fly-in on tracking start. */
const FLY_SECONDS = 0.8;
/** Framing distance = this many bounding radii (clamped to the OrbitControls limits). */
const FRAME_RADII = 3;
const MIN_FRAME_DISTANCE = 2.5;
const FRAME_ELEVATION = (32 * Math.PI) / 180;

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Follows the tracked object. On start the camera flies in to a framing distance; afterwards the
 * OrbitControls target follows the live position and the camera offset (azimuth relative to the
 * object's heading, elevation, distance) rotates with the object. AMRs start as a chase cam
 * behind their heading. Orbit/zoom input pauses auto-rotation and its result becomes the new
 * relative offset; pan releases tracking. Reads stores with getState only.
 */
export default function CameraTracker() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const controls = useThree((state) => state.controls) as unknown as Controls | null;
  const resolver = useMemo(() => new SceneObjectResolver(), []);
  // Per tracked id: the robot focus joint (null for other kinds or when the model lacks it).
  const focus = useRef<{ id: string | null; owner: Object3D | null; joint: Object3D | null }>({ id: null, owner: null, joint: null });
  const scratchRef = useRef({ goal: new Vector3(), offset: new Vector3(), from: new Vector3(), box: new Box3(), sphere: new Sphere(), lastTarget: new Vector3() });
  // Pointer type of the current drag: touch gestures pinch/pan together and never release tracking.
  const dragPointer = useRef<string>("mouse");
  const view = useRef({
    id: null as string | null,
    yaw: 0,
    relAzimuth: 0,
    elevation: FRAME_ELEVATION,
    distance: 5,
    dragging: false,
    fly: null as null | { t: number; azimuth: number; elevation: number; distance: number },
  });

  useEffect(() => {
    setSceneRoot(scene);
    return () => setSceneRoot(null);
  }, [scene]);

  // OrbitControls pans with the right button or left + ctrl/meta/shift (no key listener is set up).
  useEffect(() => {
    const element = controls?.domElement ?? gl.domElement;
    const release = (event: PointerEvent) => {
      dragPointer.current = event.pointerType;
      if (!useCameraTrackingStore.getState().trackedId || controls?.enablePan === false) return;
      const pan = event.button === 2 || (event.button === 0 && (event.ctrlKey || event.metaKey || event.shiftKey));
      if (pan && event.pointerType !== "touch") useCameraTrackingStore.getState().track(null);
    };
    element.addEventListener("pointerdown", release, { capture: true });
    return () => element.removeEventListener("pointerdown", release, { capture: true });
  }, [gl, controls]);

  // User orbit/zoom: pause auto-rotation while dragging, then keep the result as the relative offset.
  useEffect(() => {
    if (!controls) return;
    const v = view.current;
    const start = () => { v.dragging = true; v.fly = null; };
    const end = () => {
      v.dragging = false;
      const camera = (controls as unknown as { object?: { position: Vector3 } }).object;
      if (!camera) return;
      const o = scratchRef.current.offset.subVectors(camera.position, controls.target);
      v.distance = Math.max(1e-3, o.length());
      v.elevation = Math.asin(clamp(o.y / v.distance, -1, 1));
      v.relAzimuth = wrap(Math.atan2(o.x, o.z) - v.yaw);
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => { controls.removeEventListener("start", start); controls.removeEventListener("end", end); };
  }, [controls]);

  useFrame((state, delta) => {
    const id = useCameraTrackingStore.getState().trackedId;
    const v = view.current;
    if (!id || !controls) { v.id = null; return; }
    const object = resolver.resolve(id);
    if (!object) return;
    const scratch = scratchRef.current;
    const { goal, offset, box, sphere } = scratch;
    const dt = Math.min(delta, 0.1);
    const f = focus.current;
    if (f.id !== id || f.owner !== object) {
      const kind = useSceneStore.getState().objects.find((candidate) => candidate.id === id)?.kind;
      f.id = id;
      f.owner = object;
      f.joint = kind === "robot" ? object.getObjectByName(ROBOT_FOCUS_JOINT) ?? null : null;
    }
    if (f.joint) f.joint.getWorldPosition(goal);
    else {
      object.getWorldPosition(goal);
      goal.y += LOOK_HEIGHT;
    }
    // Yaw stays the base's (static for a robot); a base-to-hand direction would swing with every move.
    const yaw = worldYaw(object);

    if (v.id !== id) {
      // Fly-in: frame by bounding size, AMRs from behind, everything else keeps its current side.
      v.id = id;
      v.yaw = yaw;
      const radius = box.setFromObject(object).isEmpty() ? 0.5 : box.getBoundingSphere(sphere).radius;
      v.distance = clamp(FRAME_RADII * radius, Math.max(MIN_FRAME_DISTANCE, controls.minDistance), controls.maxDistance);
      v.elevation = FRAME_ELEVATION;
      offset.subVectors(state.camera.position, controls.target);
      const length = Math.max(1e-3, offset.length());
      const azimuth = Math.atan2(offset.x, offset.z);
      const kind = useSceneStore.getState().objects.find((candidate) => candidate.id === id)?.kind;
      v.relAzimuth = wrap((kind === "amr" ? yaw + Math.PI : azimuth) - yaw);
      v.fly = { t: 0, azimuth: wrap(azimuth - yaw), elevation: Math.asin(clamp(offset.y / length, -1, 1)), distance: length };
      scratch.from.copy(controls.target);
    }
    v.yaw += wrap(yaw - v.yaw) * (1 - Math.exp(-YAW_RATE * dt));

    if (v.dragging) {
      // Rotate/zoom keep the target; if the drag moved it since our last write, the user panned.
      if (
        controls.enablePan !== false &&
        dragPointer.current !== "touch" &&
        controls.target.distanceToSquared(scratch.lastTarget) > 1e-10
      ) {
        useCameraTrackingStore.getState().track(null);
        v.dragging = false;
        v.id = null;
        return;
      }
      // Keep following the position only; the user's rotation/zoom is applied by the controls.
      offset.subVectors(goal, controls.target).multiplyScalar(1 - Math.exp(-FOLLOW_RATE * dt));
      controls.target.add(offset);
      state.camera.position.add(offset);
      controls.update();
      scratch.lastTarget.copy(controls.target);
      return;
    }

    let relAzimuth = v.relAzimuth, elevation = v.elevation, distance = v.distance;
    if (v.fly) {
      const f = v.fly;
      f.t = Math.min(1, f.t + dt / FLY_SECONDS);
      const e = ease(f.t);
      controls.target.lerpVectors(scratch.from, goal, e);
      relAzimuth = f.azimuth + wrap(v.relAzimuth - f.azimuth) * e;
      elevation = f.elevation + (v.elevation - f.elevation) * e;
      distance = f.distance + (v.distance - f.distance) * e;
      if (f.t >= 1) v.fly = null;
    } else {
      controls.target.add(offset.subVectors(goal, controls.target).multiplyScalar(1 - Math.exp(-FOLLOW_RATE * dt)));
    }
    const azimuth = v.yaw + relAzimuth, flat = Math.cos(elevation) * distance;
    state.camera.position.set(
      controls.target.x + Math.sin(azimuth) * flat,
      controls.target.y + Math.sin(elevation) * distance,
      controls.target.z + Math.cos(azimuth) * flat,
    );
    controls.update();
    scratch.lastTarget.copy(controls.target);
  });
  return null;
}
