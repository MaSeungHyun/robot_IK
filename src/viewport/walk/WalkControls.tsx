import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { useWalkModeStore } from "@/stores/useWalkModeStore";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import { slide, walkObstacles } from "@/viewport/walk/walkCollision";
import {
  HEAD_BOB_AMPLITUDE as BOB, HEAD_BOB_STRIDE, MAX_PITCH, MOUSE_SENSITIVITY, PERSON_EYE_HEIGHT, RUN_MULTIPLIER,
  WALK_ACCELERATION, WALK_DAMPING, WALK_FOV, WALK_SPEED,
} from "@/constants/people";

const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"]);

/** Three.js camera objects are mutable scene state (not React state). */
function setFov(camera: object, fov: number) {
  if (!(camera instanceof PerspectiveCamera) || camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

type Controls = { enabled: boolean; target?: Vector3; update?: () => void };

/**
 * First-person walk camera (play only): WASD move, Shift run, pointer-lock mouse look, Esc or the button exits.
 * Collides with room walls and equipment footprints; a speed-scaled head bob eases back to rest when stopped.
 * The orbit camera pose is saved on entry and restored on exit.
 */
export default function WalkControls() {
  const active = useWalkModeStore((state) => state.active);
  const editing = useSceneStore((state) => state.editing);
  const objects = useSceneStore((state) => state.objects);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  const obstacles = useMemo(
    () => walkObstacles(objects, (id) => useSceneStore.getState().settings[id]?.doorWidth),
    [objects],
  );
  const state = useRef({
    keys: new Set<string>(),
    yaw: 0,
    pitch: 0,
    x: 0,
    z: 0,
    velocity: new Vector3(),
    phase: 0,
    bob: 0,
  });
  const scratch = useMemo(() => ({ euler: new Euler(0, 0, 0, "YXZ"), move: new Vector3() }), []);

  // Leaving play (back to the editor) ends walk mode.
  useEffect(() => {
    if (editing) useWalkModeStore.getState().setActive(false);
  }, [editing]);

  useEffect(() => {
    if (!active) return;
    const controls = get().controls as unknown as Controls | null;
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: (camera as PerspectiveCamera).fov };
    if (controls) controls.enabled = false;
    setFov(camera, WALK_FOV);
    // Object tracking would fight over the camera.
    useCameraTrackingStore.getState().track(null);
    // Start where the orbit view looks, facing the same way.
    const s = state.current, target = controls?.target ?? new Vector3();
    const direction = new Vector3().subVectors(target, camera.position);
    s.x = target.x;
    s.z = target.z;
    s.yaw = Math.atan2(-direction.x, -direction.z);
    s.pitch = 0;
    s.velocity.set(0, 0, 0);
    s.phase = 0;
    s.bob = 0;
    s.keys.clear();

    const element = gl.domElement;
    let locked = false;
    const lock = () => {
      // Throws/rejects without a user gesture or when unsupported; the canvas click retries.
      try {
        const result = element.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => {});
      } catch {
        /* ignore */
      }
    };
    lock();
    const onLockChange = () => {
      if (document.pointerLockElement === element) locked = true;
      // Esc releases the lock (the browser consumes that key): exit walk mode.
      else if (locked) useWalkModeStore.getState().setActive(false);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== element) return;
      s.yaw -= event.movementX * MOUSE_SENSITIVITY;
      s.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, s.pitch - event.movementY * MOUSE_SENSITIVITY));
    };
    const editable = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
    // Capture phase, consumed: walk keys never reach the editor shortcuts (G/R are not walk keys and pass through,
    // and the editor is inactive during play anyway).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        useWalkModeStore.getState().setActive(false);
        return;
      }
      if (!KEYS.has(event.code) || editable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      s.keys.add(event.code);
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (s.keys.delete(event.code)) event.stopPropagation();
    };
    const onBlur = () => s.keys.clear();
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);
    element.addEventListener("click", lock);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      element.removeEventListener("click", lock);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      if (document.pointerLockElement === element) document.exitPointerLock();
      // Back to the orbit camera exactly as it was.
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      setFov(camera, saved.fov);
      if (controls) {
        controls.enabled = true;
        controls.update?.();
      }
    };
  }, [active, camera, gl, get]);

  // Default priority: after OrbitControls (-1, disabled while walking) and before the composer renders.
  useFrame((_, delta) => {
    if (!active) return;
    const s = state.current, dt = Math.min(delta, 0.1);
    const forward = (s.keys.has("KeyW") ? 1 : 0) - (s.keys.has("KeyS") ? 1 : 0);
    const strafe = (s.keys.has("KeyD") ? 1 : 0) - (s.keys.has("KeyA") ? 1 : 0);
    const running = s.keys.has("ShiftLeft") || s.keys.has("ShiftRight");
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    // Camera forward is -z rotated by yaw; right is +x rotated by yaw.
    const want = scratch.move.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(running ? WALK_SPEED * RUN_MULTIPLIER : WALK_SPEED);
    s.velocity.lerp(want, 1 - Math.exp(-(want.lengthSq() > 0 ? WALK_ACCELERATION : WALK_DAMPING) * dt));
    if (s.velocity.lengthSq() < 1e-6 && want.lengthSq() === 0) s.velocity.set(0, 0, 0);
    [s.x, s.z] = slide(obstacles, s.x, s.z, s.velocity.x * dt, s.velocity.z * dt);
    // Head bob: stride frequency and amplitude follow speed; the weight eases to 0 when standing still so the
    // view settles back to rest instead of freezing mid-swing.
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    s.phase += (speed / HEAD_BOB_STRIDE) * Math.PI * dt;
    s.bob += (Math.min(speed / WALK_SPEED, 1.6) - s.bob) * (1 - Math.exp(-6 * dt));
    const bobY = Math.abs(Math.sin(s.phase)) * BOB.height * 2 - BOB.height;
    const sway = Math.sin(s.phase) * BOB.sway;
    camera.position.set(s.x + cos * sway * s.bob, PERSON_EYE_HEIGHT + bobY * s.bob, s.z - sin * sway * s.bob);
    scratch.euler.set(s.pitch, s.yaw, Math.sin(s.phase) * BOB.roll * s.bob);
    camera.quaternion.setFromEuler(scratch.euler);
  });

  return null;
}
