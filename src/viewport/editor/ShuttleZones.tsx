import { useRef } from "react";
import { useSceneStore } from "@/stores/useSceneStore";
import { useShuttleZoneStore } from "@/stores/useShuttleZoneStore";
import type { ThreeEvent } from "@react-three/fiber";
import type { Mesh } from "three";
import { STOP_ROLE_COLOR } from "@/ui/Hud/equipment/details/_components/StopPointSetting";

const ZONE_COLOR = "#02dfef";

/** Edit-mode 셔틀 구역 markers (hidden in play) and the floor click catcher of 셔틀 구역 지정 mode. */
export default function ShuttleZones() {
  const editing = useSceneStore((state) => state.editing);
  const objects = useSceneStore((state) => state.objects);
  const settings = useSceneStore((state) => state.settings);
  const placingFor = useShuttleZoneStore((state) => state.placingFor);
  const setPlacingFor = useShuttleZoneStore((state) => state.setPlacingFor);
  const placingRole = useShuttleZoneStore((state) => state.placingRole);
  const preview = useRef<Mesh>(null);
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
  const track = (event: ThreeEvent<PointerEvent>) => {
    const mesh = preview.current;
    if (!mesh || !placingFor) return;
    mesh.visible = true;
    mesh.position.set(event.point.x, 0.3, event.point.z);
    mesh.rotation.y = objects.find((o) => o.id === placingFor)?.yaw ?? 0;
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
          <mesh ref={preview} visible={false} renderOrder={3}>
            <boxGeometry args={[1.2, 0.6, 1.2]} />
            <meshBasicMaterial color={previewColor} transparent opacity={0.45} depthWrite={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} onPointerDown={place} onPointerMove={track}>
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
