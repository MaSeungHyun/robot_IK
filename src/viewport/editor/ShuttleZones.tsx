import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, EdgesGeometry, Plane, Raycaster, Vector3, type Group } from "three";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShuttleZoneStore } from "@/stores/useShuttleZoneStore";
import type { ThreeEvent } from "@react-three/fiber";
import { STOP_ROLE_COLOR } from "@/ui/Hud/equipment/details/_components/StopPointSetting";

const ZONE_COLOR = "#02dfef";
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Live cube + floor outline under the cursor while a stop point / zone is being placed. Follows the pointer every frame
 * by intersecting the floor plane, so it keeps tracking over equipment that swallows pointer events.
 */
function PlacingPreview({ color, yaw }: { color: string; yaw: number }) {
  const group = useRef<Group>(null);
  const ray = useMemo(() => new Raycaster(), []);
  const hit = useMemo(() => new Vector3(), []);
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(1.2, 0.6, 1.2)), []);
  useFrame(({ camera, pointer }) => {
    const g = group.current;
    if (!g) return;
    ray.setFromCamera(pointer, camera);
    g.visible = !!ray.ray.intersectPlane(FLOOR, hit);
    if (g.visible) g.position.set(hit.x, 0, hit.z);
    g.rotation.y = yaw;
  });
  return (
    <group ref={group} visible={false}>
      <mesh position={[0, 0.3, 0]} renderOrder={3}>
        <boxGeometry args={[1.2, 0.6, 1.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <lineSegments position={[0, 0.3, 0]} geometry={edges} renderOrder={4}>
        <lineBasicMaterial color={color} depthTest={false} />
      </lineSegments>
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <ringGeometry args={[0.9, 1.0, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
  );
}

/** Edit-mode 셔틀 구역 markers (hidden in play) and the floor click catcher of 셔틀 구역 지정 mode. */
export default function ShuttleZones() {
  const editing = useSceneStore((state) => state.editing);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const placingFor = useShuttleZoneStore((state) => state.placingFor);
  const setPlacingFor = useShuttleZoneStore((state) => state.setPlacingFor);
  const placingRole = useShuttleZoneStore((state) => state.placingRole);
  if (!editing) return null;
  const stops = objects.flatMap((o) => (settings[o.id]?.stopPoints ?? []).map((p, i) => ({ key: `${o.id}:stop:${i}`, owner: o.id, ...p })));
  const zones = objects.flatMap((o) => (settings[o.id]?.shuttleZones ?? []).map((z, i) => ({ key: `${o.id}:${i}`, owner: o.id, ...z })));
  const place = (event: ThreeEvent<PointerEvent>) => {
    if (!placingFor || event.button !== 0) return;
    event.stopPropagation();
    const state = useSceneStore.getState();
    const round = (v: number) => Math.round(v * 100) / 100;
    if (placingRole) {
      const owner = state.objects.find((o) => o.id === placingFor);
      const points = state.settings[placingFor]?.stopPoints ?? [];
      state.updateSettings(placingFor, { stopPoints: [...points, { role: placingRole, x: round(event.point.x), z: round(event.point.z), yaw: owner?.yaw ?? 0 }] });
      setPlacingFor(null);
      return;
    }
    const current = state.settings[placingFor]?.shuttleZones ?? [];
    state.updateSettings(placingFor, { shuttleZones: [...current, { x: Math.round(event.point.x * 100) / 100, z: Math.round(event.point.z * 100) / 100 }] });
    setPlacingFor(null);
  };
  const previewColor = placingRole ? STOP_ROLE_COLOR[placingRole] : ZONE_COLOR;
  return (
    <group>
      {zones.map((z) => (
        <group key={z.key} position={[z.x, 0.012, z.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh renderOrder={2}>
            <ringGeometry args={[0.72, 0.8, 48]} />
            <meshBasicMaterial color={ZONE_COLOR} transparent opacity={z.owner === placingFor ? 0.95 : 0.7} depthWrite={false} />
          </mesh>
          <mesh renderOrder={1}>
            <circleGeometry args={[0.72, 48]} />
            <meshBasicMaterial color={ZONE_COLOR} transparent opacity={0.12} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {stops.map((p) => (
        <group key={p.key}>
          <mesh position={[p.x, 0.3, p.z]} rotation={[0, p.yaw, 0]} renderOrder={2}>
            <boxGeometry args={[1.2, 0.6, 1.2]} />
            <meshBasicMaterial color={STOP_ROLE_COLOR[p.role]} transparent opacity={p.owner === placingFor ? 0.55 : 0.38} depthWrite={false} />
          </mesh>
          <group position={[p.x, 0.014, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh renderOrder={2}>
              <ringGeometry args={[0.9, 1.0, 4, 1, Math.PI / 4]} />
              <meshBasicMaterial color={STOP_ROLE_COLOR[p.role]} transparent opacity={p.owner === placingFor ? 0.95 : 0.75} depthWrite={false} />
            </mesh>
          </group>
        </group>
      ))}
      {placingFor && (
        <>
          <PlacingPreview color={previewColor} yaw={objects.find((o) => o.id === placingFor)?.yaw ?? 0} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} onPointerDown={place}>
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
