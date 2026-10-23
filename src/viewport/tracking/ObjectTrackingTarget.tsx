import { useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Euler, Group, Matrix4, Mesh, Quaternion, Vector3 } from "three";

const UP = new Vector3(0, 1, 0);
import { useCameraTrackingStore } from "@/stores/useCameraTrackingStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSceneInstances } from "@/viewport/instancing/useInstanceModel";
import {
  TRACKING_RING as R,
  TRACKING_VISUALS as C,
} from "@/viewport/tracking/tracking";
import TrackingGroundRing from "@/viewport/tracking/TrackingGroundRing";
import TrackingLiveInfo from "@/ui/tracking/TrackingLiveInfo";
import { EQUIPMENT_NAMES } from "@/stores/useSceneStore";
import { SceneObjectResolver } from "@/viewport/scene/sceneObjects";
import { trackingFootprint } from "@/viewport/tracking/trackingFootprint";

/**
 * Ring (unit-radius group) scale for a body footprint: the innermost ring hugs the body at
 * max(half width, half depth) x margin; the old full-diagonal radius was ~3x the body.
 */
const ringScale = (width: number, depth: number) =>
  Math.max(C.minRadius, (Math.max(width, depth) / 2) * C.footprintScale) /
  R.innerRing.inner;

const viewportCenter = (
  _object: unknown,
  _camera: unknown,
  size: { width: number; height: number },
): [number, number] => [size.width / 2, size.height / 2];

/** Only the tracked model contributes bounds; no per-frame React state updates. */
export default function ObjectTrackingTarget() {
  const id = useCameraTrackingStore((state) => state.trackedId);
  const name = useSceneStore(
    (state) => state.objects.find((object) => object.id === id)?.name,
  );
  const kind = useSceneStore(
    (state) => state.objects.find((object) => object.id === id)?.kind,
  );
  const instances = useSceneInstances();
  const resolver = useMemo(() => new SceneObjectResolver(), []);
  const ring = useRef<Group>(null);
  const frame = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  // Ring size is measured once per tracked object in its own local frame, so rotation (a world
  // AABB grows ~41% at 45°), carried pallets and arm swing never resize it.
  const fixed = useRef({
    id: null as string | null,
    radius: 0,
    center: new Vector3(),
    /** `center` is in the object frame (turned with it each frame) instead of a fixed world offset. */
    local: false,
  });
  // Last measured mesh bounds, relative to the object origin (or absolute when unresolved).
  const live = useRef({
    id: null as string | null,
    valid: false,
    relative: false,
    bounds: new Box3(),
  });
  // Robots: cached body meshes (whole arm) and the smoothed bracket rect [left, top, right, bottom].
  const body = useRef({
    id: null as string | null,
    owner: null as object | null,
    meshes: [] as Mesh[],
    rect: [0, 0, 0, 0],
    ready: false,
  });
  const scratch = useMemo(
    () => ({
      bounds: new Box3(),
      footprint: new Box3(),
      part: new Box3(),
      center: new Vector3(),
      size: new Vector3(),
      point: new Vector3(),
      origin: new Vector3(),
      inverse: new Matrix4(),
      quaternion: new Quaternion(),
      corners: Array.from({ length: 8 }, () => new Vector3()),
    }),
    [],
  );

  useFrame((state, delta) => {
    if (!ring.current || !frame.current) return;
    if (!id) {
      ring.current.visible = false;
      frame.current.style.display = "none";
      return;
    }
    const { bounds, footprint, part, center, size, point, corners, origin } =
      scratch;
    const object = resolver.resolve(id);
    // Same source as CameraTracker (world position, matrices refreshed after the simulator moved
    // it this frame), sampled every frame; this runs after the camera (priority 0.5 > 0).
    if (object) object.getWorldPosition(origin);

    // Heavy part (mesh bounds), throttled. Bounds are stored relative to the object origin so the
    // per-frame code below can translate them without re-measuring.
    elapsed.current += delta;
    const box = live.current;
    if (elapsed.current >= C.boundsInterval || box.id !== id) {
      elapsed.current = 0;
      bounds.makeEmpty();
      const include = (mesh: Mesh) => {
        mesh.updateWorldMatrix(true, false);
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox)
          bounds.union(
            part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld),
          );
      };
      instances?.forEachSelected(id, include);
      // Non-batched models keep their own visible geometry (for example a room).
      if (bounds.isEmpty())
        state.scene.traverse((node) => {
          if (node.userData.sceneId === id || node.userData.boxId === id)
            node.traverseVisible((child) => {
              if (child instanceof Mesh && !child.userData.trackingDecoration)
                include(child);
            });
        });
      box.id = id;
      box.valid = !bounds.isEmpty();
      if (box.valid) {
        box.bounds.copy(bounds);
        if (object) box.bounds.translate(point.copy(origin).negate());
        box.relative = !!object;
      }
    }
    ring.current.visible = box.valid;
    if (!box.valid) {
      frame.current.style.display = "none";
      return;
    }
    bounds.copy(box.bounds);
    if (box.relative) bounds.translate(origin);

    const ground = fixed.current;
    if (object && ground.id !== id) {
      object.updateWorldMatrix(true, false);
      footprint.makeEmpty();
      trackingFootprint(
        object,
        footprint,
        part,
        scratch.inverse.copy(object.matrixWorld).invert(),
      );
      if (!footprint.isEmpty()) {
        // Footprint center as a fixed world-space (unrotated) offset from the origin, so in-place
        // turns can't swing the ring around.
        footprint.getCenter(ground.center);
        // Off-centre models (forklift: footprint centre ~0.9 m ahead of its origin) keep the offset
        // in the object frame and turn it with the object; others keep a fixed world offset.
        ground.local = Math.hypot(ground.center.x, ground.center.z) > 0.2;
        if (!ground.local) ground.center.applyMatrix4(object.matrixWorld).sub(origin);
        ground.center.y = 0;
        footprint.getSize(size);
        ground.radius = ringScale(size.x, size.z);
        ground.id = id;
      }
    }
    if (object && ground.id === id) {
      // Glued to the origin every frame; no rotation is inherited (the layers spin on their own).
      if (ground.local) {
        const yaw = new Euler().setFromQuaternion(object.getWorldQuaternion(scratch.quaternion), "YXZ").y;
        center.copy(ground.center).applyAxisAngle(UP, yaw).add(origin);
      } else center.copy(origin).add(ground.center);
      ring.current.position.set(center.x, C.groundHeight, center.z);
      ring.current.scale.setScalar(ground.radius);
    } else {
      // Not measurable yet: fall back to the live world bounds until the object resolves.
      bounds.getCenter(center);
      bounds.getSize(size);
      ring.current.position.set(center.x, C.groundHeight, center.z);
      ring.current.scale.setScalar(ringScale(size.x, size.z));
    }

    // CameraTracker moved the camera this frame; refresh its matrices before projecting, otherwise
    // the bracket/label use last frame's view and wobble against the 3D scene.
    state.camera.updateMatrixWorld();
    // Bracket box: the ring circle (fixed radius, around the ring center) by the live height,
    // aligned to the camera's ground azimuth. Unlike the world AABB it cannot breathe with yaw.
    const radius =
      (ring.current.scale.x * R.innerRing.inner) / C.footprintScale;
    const e = state.camera.matrixWorld.elements;
    const flat = Math.hypot(e[0], e[2]) || 1;
    const rx = (e[0] / flat) * radius,
      rz = (e[2] / flat) * radius;
    // Robots: the bracket encloses the whole moving arm (live bounds of its own meshes, every
    // frame); the camera still follows hand03 and the ring stays at the base.
    const arm = body.current;
    let whole = false;
    if (kind === "robot" && object) {
      if (arm.id !== id || arm.owner !== object) {
        arm.id = id;
        arm.owner = object;
        arm.ready = false;
        arm.meshes.length = 0;
        object.traverse((node) => {
          if (!(node instanceof Mesh) || node.userData.trackingDecoration)
            return;
          // Skip anything owned by another scene object (e.g. a carried box).
          let owner = node.parent;
          while (
            owner &&
            owner !== object &&
            owner.userData.sceneId === undefined &&
            !owner.userData.cargo
          )
            owner = owner.parent;
          if (owner === object) arm.meshes.push(node);
        });
      }
      whole = arm.meshes.length > 0;
      if (whole) object.updateWorldMatrix(true, true);
    }
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    let clipped = false;
    // Robot: each arm mesh's own box corners (tighter than one world AABB of the whole arm).
    const boxes = whole ? arm.meshes.length : 1;
    for (let i = 0; i < boxes * 8; i++) {
      const side = i & 1 ? 1 : -1,
        depth = i & 4 ? 1 : -1;
      if (whole) {
        const mesh = arm.meshes[i >> 3];
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        if (!box) continue;
        point
          .set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          )
          .applyMatrix4(mesh.matrixWorld);
      } else
        point.copy(
          corners[i].set(
            center.x + side * rx - depth * rz,
            i & 2 ? bounds.max.y : bounds.min.y,
            center.z + side * rz + depth * rx,
          ),
        );
      point.project(state.camera);
      if (point.z < -1 || point.z > 1) clipped = true;
      const x = ((point.x + 1) * state.size.width) / 2;
      const y = ((1 - point.y) * state.size.height) / 2;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (whole) {
      // Light, frame-rate independent smoothing of the arm rect (snaps on the first frame).
      const rect = arm.rect,
        k = arm.ready ? 1 - Math.exp(-C.bracketRate * Math.min(delta, 0.1)) : 1;
      rect[0] += (left - rect[0]) * k;
      rect[1] += (top - rect[1]) * k;
      rect[2] += (right - rect[2]) * k;
      rect[3] += (bottom - rect[3]) * k;
      arm.ready = true;
      [left, top, right, bottom] = rect;
    }
    frame.current.style.display = clipped ? "none" : "block";
    frame.current.style.transform = `translate3d(${left - C.framePadding}px,${top - C.framePadding}px,0)`;
    frame.current.style.width = `${right - left + C.framePadding * 2}px`;
    frame.current.style.height = `${bottom - top + C.framePadding * 2}px`;
  }, 0.5);

  if (!id) return null;
  return (
    <>
      <group ref={ring} visible={false} userData={{ trackingDecoration: true }}>
        <TrackingGroundRing />
      </group>
      <Html
        fullscreen
        calculatePosition={viewportCenter}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none", overflow: "hidden" }}
      >
        <div
          ref={frame}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 hidden text-brand-primary"
        >
          <span className="absolute top-0 left-0 size-5 border-t-4 border-l-4 drop-shadow-[0_0_5px_#22d3ee]" />
          <span className="absolute top-0 right-0 size-5 border-t-4 border-r-4 drop-shadow-[0_0_5px_#22d3ee]" />
          <span className="absolute bottom-0 left-0 size-5 border-b-4 border-l-4 drop-shadow-[0_0_5px_#22d3ee]" />
          <span className="absolute right-0 bottom-0 size-5 border-r-4 border-b-4 drop-shadow-[0_0_5px_#22d3ee]" />

          <svg
            className="absolute -top-6 left-full h-7 w-12 overflow-visible drop-shadow-[0_0_4px_#22d3ee]"
            viewBox="0 0 48 28"
            fill="none"
          >
            <path d="M0 28 L24 4 H48" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <div className="absolute -top-11 left-full ml-12 flex min-w-36 items-start gap-2 whitespace-nowrap rounded border border-brand-primary/80 bg-bg-primary/85 px-3 py-2 text-[11px] tracking-wide shadow-[0_0_16px_#22d3ee30,inset_0_0_12px_#22d3ee10] pr-6">
            <span className="mt-1 size-1.5 rounded-full bg-cyan-200 shadow-[0_0_8px_2px_#22d3ee]" />
            <div>
              <p className="font-semibold text-white">{name ?? id}</p>
              <p className="mt-0.5 text-[10px] text-brand-primary">
                TRACKING ACTIVE{kind ? ` · ${EQUIPMENT_NAMES[kind]}` : ""}
              </p>
              <TrackingLiveInfo id={id} amr={kind === "amr"} />
            </div>
          </div>
        </div>
      </Html>
    </>
  );
}
