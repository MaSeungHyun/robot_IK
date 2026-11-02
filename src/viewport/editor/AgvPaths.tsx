import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Plane, Raycaster, Vector3, type Group } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { useAgvPathStore } from "@/stores/useAgvPathStore";
import { useShuttleZoneStore } from "@/stores/useShuttleZoneStore";
import { AGV_PATH_COLOR } from "@/ui/Hud/equipment/amr/AgvPathSetting";

const FLOOR = new Plane(new Vector3(0, 1, 0), 0);
const Y = 0.03;

/** A drawn AGV path: line segments plus a ring per waypoint (the first one larger). */
function PathLine({ points, active }: { points: readonly { x: number; z: number }[]; active: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry(), out: number[] = [];
    for (let i = 1; i < points.length; i++) out.push(points[i - 1].x, Y, points[i - 1].z, points[i].x, Y, points[i].z);
    g.setAttribute("position", new Float32BufferAttribute(out, 3));
    return g;
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group>
      <lineSegments geometry={geometry} renderOrder={4}>
        <lineBasicMaterial color={AGV_PATH_COLOR} transparent opacity={active ? 1 : 0.7} depthTest={false} />
      </lineSegments>
      {points.map((p, i) => (
        <mesh key={i} position={[p.x, Y, p.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
          <ringGeometry args={i === 0 ? [0.22, 0.32, 24] : [0.12, 0.2, 24]} />
          <meshBasicMaterial color={AGV_PATH_COLOR} transparent opacity={active ? 0.95 : 0.7} depthWrite={false} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Live segment from the last waypoint to the cursor (floor raycast every frame, like the stop point preview). */
function PathPreview({ from }: { from: { x: number; z: number } | null }) {
  const cursor = useRef<Group>(null);
  const ray = useMemo(() => new Raycaster(), []);
  const hit = useMemo(() => new Vector3(), []);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Array(6).fill(0), 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ camera, pointer }) => {
    ray.setFromCamera(pointer, camera);
    const ok = !!ray.ray.intersectPlane(FLOOR, hit);
    if (cursor.current) {
      cursor.current.visible = ok;
      cursor.current.position.set(hit.x, Y, hit.z);
    }
    const attr = geometry.getAttribute("position") as Float32BufferAttribute;
    if (ok && from) attr.set([from.x, Y, from.z, hit.x, Y, hit.z]);
    else attr.set([0, 0, 0, 0, 0, 0]);
    attr.needsUpdate = true;
  });
  return (
    <group>
      <lineSegments geometry={geometry} renderOrder={4} frustumCulled={false}>
        <lineBasicMaterial color={AGV_PATH_COLOR} transparent opacity={0.5} depthTest={false} />
      </lineSegments>
      <group ref={cursor} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
          <ringGeometry args={[0.12, 0.2, 24]} />
          <meshBasicMaterial color={AGV_PATH_COLOR} transparent opacity={0.6} depthWrite={false} depthTest={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Edit-mode AGV 경로 lines (hidden in play) and the floor click catcher of 경로 추가 mode. */
export default function AgvPaths() {
  const editing = useSceneStore((state) => state.editing);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const drawingFor = useAgvPathStore((state) => state.drawingFor);
  const setDrawingFor = useAgvPathStore((state) => state.setDrawingFor);
  const placing = useShuttleZoneStore((state) => !!state.placingFor);
  useEffect(() => {
    if (!drawingFor) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawingFor(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawingFor, setDrawingFor]);
  if (!editing) return null;
  const paths = objects.map((o) => ({ id: o.id, points: settings[o.id]?.agvPath ?? [] })).filter((p) => p.points.length);
  const current = drawingFor ? settings[drawingFor]?.agvPath ?? [] : [];
  const add = (event: ThreeEvent<PointerEvent>) => {
    if (!drawingFor || event.button !== 0) return;
    event.stopPropagation();
    const state = useSceneStore.getState();
    const round = (v: number) => Math.round(v * 100) / 100;
    const points = state.settings[drawingFor]?.agvPath ?? [];
    state.updateSettings(drawingFor, { agvPath: [...points, { x: round(event.point.x), z: round(event.point.z) }] });
  };
  return (
    <group>
      {paths.map((p) => <PathLine key={p.id} points={p.points} active={p.id === drawingFor} />)}
      {drawingFor && !placing && (
        <>
          <PathPreview from={current.length ? current[current.length - 1] : null} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} onPointerDown={add}>
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
