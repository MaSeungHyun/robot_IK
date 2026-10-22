import type { FloorSize } from "@/types/layout";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, InstancedMesh, Object3D, Vector3 } from "three";
import { useRoomMaps } from "@/objects/room/roomMaterials";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import RoomFrame from "./RoomFrame";
import useSceneGlow from "@/viewport/useSceneGlow";
import { GLOW_GAIN } from "@/constants/viewport";
import type { RoomBeam } from "./RoomFrame";

const noRaycast = () => {};
/** LED panel (m): long axis along X, one per joist bay cell. */
const PANEL = { width: 1.2, depth: 0.6 } as const;
/** Primary lattice girders run along Z at ~9 m; open-web joists run along X every 3 m. */
const GRID = { girderSpacing: 9, joistSpacing: 3, cell: 3 } as const;

/** Rectangular LED panels: one instanced, unlit quad set (no real lights; glow only via the "high" scene bloom). */
function LedPanels({ panels, y }: { panels: [number, number][]; y: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const glow = useSceneGlow();
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new Object3D();
    transform.rotation.x = Math.PI / 2; // plane faces down
    panels.forEach(([x, z], index) => {
      transform.position.set(x, y, z);
      transform.updateMatrix();
      mesh.current!.setMatrixAt(index, transform.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [panels, y]);
  if (!panels.length) return null;
  return (
    <instancedMesh key={panels.length} ref={mesh} args={[undefined, undefined, panels.length]} raycast={noRaycast}>
      <planeGeometry args={[PANEL.width, PANEL.depth]} />
      {/* Unlit near-white; HDR only while scene bloom is on. */}
      {glow ? (
        // HDR white above the scene-bloom threshold ("high" tier only).
        <meshBasicMaterial key="glow" color={[GLOW_GAIN.led, GLOW_GAIN.led, GLOW_GAIN.led]} toneMapped={false} />
      ) : (
        <meshBasicMaterial key="flat" color="#f4f7f8" />
      )}
    </instancedMesh>
  );
}

/**
 * Ceiling (reference: light-grey lattice roof with a regular LED grid): ribbed steel deck facing
 * down, deep Warren girders along Z every ~9 m, open-web joists along X every ~3 m and one LED
 * panel (1.2 × 0.6 m) per 3 m bay cell. All members are one instanced box mesh (1 draw call), the
 * panels one instanced unlit quad mesh (1 draw call). Hidden while the camera is above the roof or
 * when the ceiling setting is off; the "performance" tier keeps only the plain deck.
 */
export default function RoomRoof({ width, depth, wallHeight: height }: FloorSize) {
  const enabled = useViewportSettingsStore((state) => state.ceiling);
  const lowQuality = useViewportSettingsStore((state) => state.renderQuality === "performance");
  const group = useRef<Group>(null);
  const cameraPoint = useMemo(() => new Vector3(), []);
  // Deck PBR set (null on the performance tier). Plane U = world X, so the deck lines run
  // across the width, parallel to the trusses and perpendicular to the purlins they rest on.
  const deck = useRoomMaps("ceiling", width, depth);
  const { beams, panels, bottom } = useMemo(() => {
    const beams: RoomBeam[] = [];
    const panels: [number, number][] = [];
    const top = height - 0.06; // top chords sit just under the deck
    // Warren lattice between two parallel chords from a → b (horizontal), depth d, panel length p.
    const lattice = (a: [number, number], b: [number, number], d: number, p: number, chord: number) => {
      const [ax, az] = a, [bx, bz] = b;
      const length = Math.hypot(bx - ax, bz - az);
      const low = top - d;
      beams.push({ from: [ax, top, az], to: [bx, top, bz], thickness: chord });
      beams.push({ from: [ax, low, az], to: [bx, low, bz], thickness: chord });
      const n = Math.max(2, Math.round(length / p));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const p0: [number, number] = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const p1: [number, number] = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        beams.push({ from: [p0[0], i % 2 ? top : low, p0[1]], to: [p1[0], i % 2 ? low : top, p1[1]], thickness: chord * 0.5 });
      }
    };
    // Primary girders along Z (deep lattice), wall to wall.
    const girderDepth = Math.min(1.1, height * 0.14);
    const girders = Math.max(1, Math.round(width / GRID.girderSpacing));
    const girderChord = Math.min(0.14, width / 25, height / 25);
    for (let i = 0; i <= girders; i++) {
      const x = -width / 2 + (width * i) / girders;
      lattice([x, -depth / 2], [x, depth / 2], girderDepth, girderDepth * 1.1, girderChord);
    }
    // Secondary open-web joists along X, framing rectangular bays between the girders.
    const joistDepth = Math.min(0.45, girderDepth * 0.45);
    const joists = Math.max(1, Math.round(depth / GRID.joistSpacing));
    for (let j = 0; j <= joists; j++) {
      const z = -depth / 2 + (depth * j) / joists;
      lattice([-width / 2, z], [width / 2, z], joistDepth, joistDepth * 1.4, girderChord * 0.5);
      // One LED panel per bay cell, centred between this joist and the next.
      if (j < joists) {
        const mid = z + depth / joists / 2;
        const across = Math.max(1, Math.round(width / GRID.cell));
        for (let i = 0; i < across; i++) panels.push([-width / 2 + (width * (i + 0.5)) / across, mid]);
      }
    }
    return { beams, panels, bottom: top - joistDepth };
  }, [width, depth, height]);
  useFrame(({ camera }) => {
    if (group.current) {
      camera.getWorldPosition(cameraPoint);
      group.current.worldToLocal(cameraPoint);
      group.current.visible = cameraPoint.y < height;
    }
  });
  if (!enabled) return null;
  return (
    <group ref={group}>
      {/* rotation +90° about X: the single-sided plane faces down, so it is see-through from above. */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[width, depth]} />
        {deck ? (
          <meshStandardMaterial key="pbr" {...deck} color="#ffffff" roughness={1} metalness={0.1} />
        ) : (
          <meshStandardMaterial key="flat" color="#8f9091" roughness={0.8} metalness={0.1} />
        )}
      </mesh>
      {!lowQuality && <>
        <RoomFrame beams={beams} />
        {/* Panels sit in the bay cells just under the deck, above the joist bottom chords. */}
        <LedPanels panels={panels} y={Math.max(bottom + 0.05, height - 0.12)} />
      </>}
    </group>
  );
}
