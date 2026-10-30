import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, OrbitControls } from "@react-three/drei";
import {
  OrthographicCamera,
  PerspectiveCamera,
  Spherical,
  Vector3,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import AxisGizmo from "@/viewport/camera/AxisGizmo";
import { useSceneStore } from "@/stores/useSceneStore";
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import { focusSphere, selectedFocusId } from "@/viewport/camera/frameSelected";
import { useWalkModeStore } from "@/stores/useWalkModeStore";
import { bookmarkScope, legacyBookmarkScope, bookmarkSlot, loadBookmarks, saveBookmark, showBookmarkToast, slotLabel } from "@/viewport/camera/cameraBookmarks";
import { loadView, saveView } from "@/viewport/camera/cameraPersist";

const TARGET: [number, number, number] = [0, 0.45, 0];
const MAX_POLAR = Math.PI / 2.05;
/** The ortho camera sits this far from the target so nothing in the layout is clipped by near. */
const ORTHO_DISTANCE = 100;
/** Dolly-zoom end lens (deg): close enough to parallel that the ortho swap is invisible. */
const MIN_FOV = 2;
/** Near/far slack around the target distance (m) during the dolly-zoom and in ortho. */
const CLIP_MARGIN = 200;
/** Gizmo view directions below the horizon (the -Y axis head) are ignored. */
const MIN_VIEW_Y = -1e-3;
const PANEL_WIDTH = 320 + 16;
/** Debounce (ms) before the current view is written to localStorage. */
const SAVE_DELAY = 400;
/** Lens and start view per template lighting preset (factory.glb "Camera"); near never below 0.5 (FloorMarking z-fighting). */
const TEMPLATE_VIEW = {
  factory: {
    lens: { fov: 25.2, near: 0.5, far: 2000 },
    position: [37.52, 20.5, 65.84] as const,
    target: [13.67, 7.42, 23.89] as const,
  },
};

function createOrtho() {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, ORTHO_DISTANCE * 20);
  // r3f refits a non-manual default camera's frustum to the canvas on resize; we fit it ourselves.
  (camera as OrthographicCamera & { manual?: boolean }).manual = true;
  return camera;
}

/** Gizmo view change tween length (s). */
const TARGET_DURATION = 0.1;
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const tweenSpherical = new Spherical();
/** Frame-selected (F) tween length (s) and the fit margin around the bounding sphere. */
const FOCUS_DURATION = 0.5;
const FOCUS_MARGIN = 1.3;

const halfTan = (camera: PerspectiveCamera) =>
  Math.tan((camera.fov * Math.PI) / 360);

/**
 * Editor camera: OrbitControls driving the default PerspectiveCamera, plus a view cube (editing
 * only). Clicking the cube snaps around the orbit target into an OrthographicCamera whose zoom
 * matches the perspective framing at the target distance; pan/zoom keep ortho, the first rotate
 * step swaps back to perspective with the same direction and apparent size. The controls keep one
 * instance (their `object` is swapped) so target and listeners survive the switch.
 */
export default function CameraRig() {
  const get = useThree((state) => state.get);
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const editing = useSceneStore((state) => state.editing);
  const selected = useSceneStore((state) => state.selected !== null);
  const drawingFloor = useSceneStore(
    (state) => state.editing && state.pending === "floor",
  );
  const [initialCamera] = useState(() => get().camera as PerspectiveCamera);
  const [defaultLens] = useState(() => ({ fov: initialCamera.fov, near: initialCamera.near, far: initialCamera.far }));
  const perspectiveRef = useRef(initialCamera);
  // A ref (not memo/state): the handlers below mutate it after render.
  const orthoRef = useRef<OrthographicCamera | null>(null);
  orthoRef.current ??= createOrtho();
  const [isOrtho, setOrtho] = useState(false);
  const controls = useRef<OrbitControlsImpl>(null);
  const rotating = useRef(false);
  const scratch = useMemo(() => new Vector3(), []);

  // r3f only fits the frustum of its own default camera; this one is manual.
  useEffect(() => {
    const ortho = orthoRef.current!;
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix();
  }, [size]);

  // The perspective camera's own lens; the dolly-zoom tween narrows it and must always restore it.
  const lensRef = useRef<{ fov: number; near: number; far: number } | null>(
    null,
  );
  lensRef.current ??= {
    fov: initialCamera.fov,
    near: initialCamera.near,
    far: initialCamera.far,
  };

  /** Near/far for a camera `distance` from the target: the layout stays inside the range. */
  const fitClip = (
    camera: PerspectiveCamera | OrthographicCamera,
    distance: number,
  ) => {
    const lens = lensRef.current!;
    camera.near = Math.max(lens.near, distance - CLIP_MARGIN);
    camera.far = Math.max(lens.far, distance + CLIP_MARGIN * 10);
  };

  const toPerspective = useMemo(
    () => () => {
      const c = controls.current,
        ortho = orthoRef.current!,
        perspective = perspectiveRef.current,
        lens = lensRef.current!;
      if (!c || get().camera !== ortho) return;
      const direction = scratch
        .subVectors(ortho.position, c.target)
        .normalize();
      perspective.fov = lens.fov;
      perspective.near = lens.near;
      perspective.far = lens.far;
      const distance =
        get().size.height / (2 * ortho.zoom * halfTan(perspective));
      perspective.position.copy(c.target).addScaledVector(direction, distance);
      perspective.up.set(0, 1, 0);
      // r3f did not refit it while it was not the default camera.
      perspective.aspect = get().size.width / get().size.height;
      perspective.lookAt(c.target);
      perspective.updateProjectionMatrix();
      c.object = perspective;
      set({ camera: perspective });
      setOrtho(false);
      c.update();
    },
    [get, set, scratch],
  );

  /** Final step of a gizmo view change: the near-ortho perspective -> real ortho, same pose and size. */
  const enterOrtho = (dir: Vector3, distance: number, height: number) => {
    const c = controls.current,
      ortho = orthoRef.current!,
      perspective = perspectiveRef.current,
      lens = lensRef.current!;
    if (!c) return;
    // Same distance as the tween's last frame, so distance-based effects (grid fade, roof/wall
    // hiding) do not pop at the swap.
    ortho.position.copy(c.target).addScaledVector(dir, distance);
    ortho.up.set(0, 1, 0);
    ortho.zoom = get().size.height / Math.max(1e-3, height);
    fitClip(ortho, distance);
    ortho.lookAt(c.target);
    ortho.updateProjectionMatrix();
    perspective.fov = lens.fov;
    perspective.near = lens.near;
    perspective.far = lens.far;
    perspective.updateProjectionMatrix();
    c.object = ortho;
    set({ camera: ortho });
    setOrtho(true);
    c.update();
  };

  const tween = useRef<null | {
    t: number;
    from: Spherical;
    to: Spherical;
    dir: Vector3;
    /** Visible height at the target, held constant by the dolly-zoom. */
    height: number;
    logTan0: number;
    logTan1: number;
    distance: number;
  }>(null);

  /** Stops a running tween and gives the perspective camera its lens back at the same apparent size. */
  const cancelTween = useMemo(
    () => () => {
      const run = tween.current,
        c = controls.current,
        perspective = perspectiveRef.current,
        lens = lensRef.current!;
      tween.current = null;
      if (!run || !c) return;
      const direction = scratch
        .subVectors(perspective.position, c.target)
        .normalize();
      perspective.fov = lens.fov;
      perspective.near = lens.near;
      perspective.far = lens.far;
      perspective.position
        .copy(c.target)
        .addScaledVector(direction, run.height / (2 * halfTan(perspective)));
      perspective.updateProjectionMatrix();
      c.update();
    },
    [scratch],
  );

  /** Gizmo click: rotate + dolly-zoom in perspective around the fixed target, then switch to ortho. */
  const snap = (direction: Vector3) => {
    const c = controls.current;
    if (!c || direction.y < MIN_VIEW_Y) return;
    // Restart from the current pose (an ortho view first returns to the matching perspective).
    cancelTween();
    toPerspective();
    const perspective = perspectiveRef.current;
    const dir = direction.clone().normalize();
    // Straight down: nudge toward +Z so lookAt stays defined and -Z is up on screen (theta = 0).
    if (dir.y > 1 - 1e-6) dir.set(0, 1, 1e-4).normalize();
    const offset = scratch.subVectors(perspective.position, c.target);
    const from = new Spherical().setFromVector3(offset);
    const to = new Spherical().setFromVector3(dir);
    to.radius = from.radius;
    // Top view keeps theta 0 regardless of float noise; otherwise take the short way round.
    if (to.phi < 1e-3) to.theta = 0;
    to.theta = from.theta + wrap(to.theta - from.theta);
    const tan0 = halfTan(perspective);
    tween.current = {
      t: 0,
      from,
      to,
      dir,
      height: 2 * from.radius * tan0,
      logTan0: Math.log(tan0),
      logTan1: Math.log(Math.tan((MIN_FOV * Math.PI) / 360)),
      distance: from.radius,
    };
  };

  /** Frame selected (F): one-shot ease of target + camera (distance, or zoom in ortho); not tracking. */
  const focus = useRef<null | {
    t: number;
    fromTarget: Vector3;
    toTarget: Vector3;
    fromPosition: Vector3;
    toPosition: Vector3;
    fromZoom: number;
    toZoom: number;
  }>(null);
  const cancelFocus = useMemo(
    () => () => {
      focus.current = null;
    },
    [],
  );

  // Any user orbit/pan/zoom cancels a running tween.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.addEventListener("start", cancelTween);
    c.addEventListener("start", cancelFocus);
    return () => {
      c.removeEventListener("start", cancelTween);
      c.removeEventListener("start", cancelFocus);
    };
  }, [cancelTween, cancelFocus]);

  // F: frame the selected equipment / box at its current position. Ignored while camera tracking
  // (tracking owns the camera), while typing and with nothing selected.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        event.defaultPrevented
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="textbox"]',
        )
      )
        return;
      if (
        document.querySelector('[role="dialog"]:not([data-keeps-shortcuts]),[role="listbox"],[role="menu"]')
      )
        return;
      if (useCameraTrackingStore.getState().trackedId) return;
      const c = controls.current,
        id = selectedFocusId();
      if (!c || !id) return;
      const sphere = focusSphere(id);
      if (!sphere) return;
      event.preventDefault();
      cancelTween();
      const camera = get().camera as PerspectiveCamera | OrthographicCamera;
      const dir = new Vector3().subVectors(camera.position, c.target);
      const current = dir.length();
      dir.normalize();
      const { width, height } = get().size;
      let toPosition: Vector3,
        toZoom = camera.zoom;
      if (camera === orthoRef.current) {
        // Ortho: keep the camera distance, fit by zoom.
        toPosition = sphere.center.clone().addScaledVector(dir, current);
        toZoom = Math.min(width, height) / (2 * sphere.radius * FOCUS_MARGIN);
      } else {
        const perspective = camera as PerspectiveCamera;
        const vertical = halfTan(perspective),
          horizontal = vertical * (width / Math.max(1, height));
        const distance =
          (sphere.radius * FOCUS_MARGIN) /
          Math.sin(Math.atan(Math.min(vertical, horizontal)));
        toPosition = sphere.center.clone().addScaledVector(dir, distance);
      }
      focus.current = {
        t: 0,
        fromTarget: c.target.clone(),
        toTarget: sphere.center.clone(),
        fromPosition: camera.position.clone(),
        toPosition,
        fromZoom: camera.zoom,
        toZoom,
      };
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [get, cancelTween]);

  // Camera bookmarks (play mode only): Shift+1..0 saves the current view, 1..0 eases to it.
  // event.code, so Shift+digit still reads as the digit; ignored while typing, walking or tracking.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const slot = bookmarkSlot(event.code);
      if (slot < 0 || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented || event.repeat) return;
      const scene = useSceneStore.getState();
      if (scene.editing) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
      if (document.querySelector('[role="dialog"]:not([data-keeps-shortcuts]),[role="listbox"],[role="menu"]')) return;
      if (useWalkModeStore.getState().active || useCameraTrackingStore.getState().trackedId) return;
      const c = controls.current;
      if (!c) return;
      const camera = get().camera as PerspectiveCamera | OrthographicCamera;
      const scope = bookmarkScope(scene.props);
      event.preventDefault();
      if (event.shiftKey) {
        saveBookmark(scope, slot, { position: camera.position.toArray(), target: c.target.toArray() }, scene.camera?.bookmarks);
        showBookmarkToast(`카메라 ${slotLabel(slot)}번 위치 저장`);
        return;
      }
      const bookmark = loadBookmarks(scope, scene.camera?.bookmarks)[slot];
      if (!bookmark) {
        showBookmarkToast(`카메라 ${slotLabel(slot)}번: 저장된 위치 없음 (Shift+${slotLabel(slot)}로 저장)`);
        return;
      }
      cancelTween();
      focus.current = {
        t: 0,
        fromTarget: c.target.clone(),
        toTarget: new Vector3(...bookmark.target),
        fromPosition: camera.position.clone(),
        toPosition: new Vector3(...bookmark.position),
        fromZoom: camera.zoom,
        toZoom: camera.zoom,
      };
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [get, cancelTween]);

  // Tracking takes over the camera: drop a running focus.
  useEffect(
    () =>
      useCameraTrackingStore.subscribe((state) => {
        if (state.trackedId) focus.current = null;
      }),
    [],
  );

  useFrame((_, delta) => {
    const run = focus.current,
      c = controls.current;
    if (!run || !c) return;
    run.t = Math.min(1, run.t + delta / FOCUS_DURATION);
    const e = easeInOutCubic(run.t);
    const camera = get().camera as PerspectiveCamera | OrthographicCamera;
    c.target.lerpVectors(run.fromTarget, run.toTarget, e);
    camera.position.lerpVectors(run.fromPosition, run.toPosition, e);
    if (camera === orthoRef.current) {
      camera.zoom = run.fromZoom + (run.toZoom - run.fromZoom) * e;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(c.target);
    c.update();
    if (run.t >= 1) focus.current = null;
  });

  // After OrbitControls' own update (priority -1), so the tween pose is what renders.
  useFrame((_, delta) => {
    const run = tween.current,
      c = controls.current;
    if (!run || !c) return;
    run.t = Math.min(1, run.t + delta / TARGET_DURATION);
    const e = easeInOutCubic(run.t);
    // Dolly-zoom: tan(fov/2) eased in log space, distance keeps h = 2·d·tan(fov/2) constant.
    const tan = Math.exp(run.logTan0 + (run.logTan1 - run.logTan0) * e);
    run.distance = run.height / (2 * tan);
    const camera = perspectiveRef.current;
    camera.fov = (2 * Math.atan(tan) * 180) / Math.PI;
    fitClip(camera, run.distance);
    camera.updateProjectionMatrix();
    const s = tweenSpherical.set(
      run.distance,
      Math.max(1e-4, run.from.phi + (run.to.phi - run.from.phi) * e),
      run.from.theta + (run.to.theta - run.from.theta) * e,
    );
    camera.position.setFromSpherical(s).add(c.target);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.target);
    if (run.t >= 1) {
      tween.current = null;
      enterOrtho(run.dir, run.distance, run.height);
    }
  });
  // A press on the gizmo: r3f's listener runs before OrbitControls' (same element, attached
  // first), so disabling here keeps the press from starting an orbit/rotate (and the ortho exit).
  const suspendControls = () => {
    const c = controls.current;
    if (!c || !c.enabled) return;
    c.enabled = false;
    rotating.current = false;
    const restore = () => {
      c.enabled = true;
      window.removeEventListener("pointerup", restore);
      window.removeEventListener("pointercancel", restore);
    };
    window.addEventListener("pointerup", restore);
    window.addEventListener("pointercancel", restore);
  };

  // A plain left drag (or one-finger touch) is a rotate; mark it so the first change swaps back.
  useEffect(() => {
    const element = gl.domElement.parentElement ?? gl.domElement;
    const touches = new Set<number>();
    const down = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        touches.add(event.pointerId);
        // A second finger turns the gesture into pinch/pan, which keeps ortho.
        rotating.current = touches.size === 1;
      } else
        rotating.current =
          event.button === 0 &&
          !(event.ctrlKey || event.metaKey || event.shiftKey);
    };
    const up = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      rotating.current = false;
    };
    element.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const change = () => {
      if (rotating.current && get().camera === orthoRef.current)
        toPerspective();
    };
    c.addEventListener("change", change);
    return () => c.removeEventListener("change", change);
  }, [get, toPerspective]);

  // Play mode (and tracking) stays perspective.
  useEffect(() => {
    if (!editing) {
      cancelTween();
      toPerspective();
    }
  }, [editing, toPerspective, cancelTween]);

  // Tracking drives a perspective orbit.
  const tracking = useCameraTrackingStore((state) => state.trackedId !== null);
  useEffect(() => {
    if (tracking) {
      cancelTween();
      toPerspective();
    }
  }, [tracking, toPerspective, cancelTween]);

  // A template lighting preset brings its own lens and start view; reloading the template (new props) re-applies it.
  const lighting = useSceneStore((state) => state.lighting);
  const templateProps = useSceneStore((state) => state.props);
  useEffect(() => {
    const view = lighting ? TEMPLATE_VIEW[lighting] : null;
    const c = controls.current, perspective = perspectiveRef.current, lens = lensRef.current!;
    if (view) { cancelTween(); toPerspective(); }
    Object.assign(lens, view ? view.lens : defaultLens);
    perspective.fov = lens.fov;
    perspective.near = lens.near;
    perspective.far = lens.far;
    if (view && c) {
      perspective.position.set(...view.position);
      c.target.set(...view.target);
    }
    // The last view the user left this template at wins over the start view; else the template's shipped view.
    const shipped = useSceneStore.getState().camera?.view;
    const saved = loadView(bookmarkScope(templateProps)) ?? loadView(legacyBookmarkScope(templateProps)) ?? (shipped ? { position: [...shipped.position] as [number, number, number], target: [...shipped.target] as [number, number, number] } : null);
    if (saved && c) {
      cancelTween();
      toPerspective();
      focus.current = null;
      perspective.position.set(...saved.position);
      c.target.set(...saved.target);
    }
    perspective.updateProjectionMatrix();
    c?.update();
  }, [lighting, templateProps, defaultLens, toPerspective, cancelTween]);

  // Persist the view (debounced). Waits out fly-to / gizmo tweens and skips tracking, walking and ortho.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    let timer = 0;
    const flush = () => {
      if (focus.current || tween.current) {
        timer = window.setTimeout(flush, SAVE_DELAY);
        return;
      }
      timer = 0;
      if (useCameraTrackingStore.getState().trackedId || useWalkModeStore.getState().active) return;
      const camera = get().camera;
      if (camera !== perspectiveRef.current) return;
      saveView(bookmarkScope(useSceneStore.getState().props), {
        position: camera.position.toArray(),
        target: c.target.toArray(),
      });
    };
    const change = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, SAVE_DELAY);
    };
    c.addEventListener("change", change);
    return () => {
      c.removeEventListener("change", change);
      window.clearTimeout(timer);
    };
  }, [get]);

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        camera={initialCamera}
        enableRotate={!drawingFloor}
        target={TARGET}
        enableDamping={false}
        maxPolarAngle={isOrtho ? Infinity : MAX_POLAR}
      />
      {editing && (
        <GizmoHelper
          alignment="bottom-right"
          margin={[selected ? 80 + PANEL_WIDTH : 80, 80]}
          renderPriority={2}
        >
          <AxisGizmo onSelect={snap} onPress={suspendControls} />
        </GizmoHelper>
      )}
    </>
  );
}
