import type { FloorSize } from "@/types/layout";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Vector3 } from "three";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import { createRoomTexture } from "@/utils/scene/roomTextures";
import RoomFrame from "./RoomFrame";
import type { RoomBeam } from "./RoomFrame";

const noRaycast = () => {};
export default function RoomRoof({ width, depth, wallHeight: height }: FloorSize) {
  const group = useRef<Group>(null);
  const cameraPoint = useMemo(() => new Vector3(), []);
  const texture = useMemo(() => createRoomTexture("ceiling", width / 0.3, depth / 4), [width, depth]);
  useEffect(() => () => texture.dispose(), [texture]);
  const { beams, rows, bottom } = useMemo(() => {
    const beams: RoomBeam[] = [];
    const rows: number[] = [];
    const trussHeight = Math.min(0.65, height * 0.16, width * 0.12);
    const bottom = height - trussHeight;
    const thickness = Math.min(0.07, width / 25, height / 25);
    const count = Math.max(1, Math.ceil(depth / C.trussSpacing));
    const segments = Math.max(2, Math.ceil(width / 1.4));
    for (let row = 0; row <= count; row++) {
      const z = -depth / 2 + depth * row / count;
      rows.push(z);
      for (const y of [bottom, height - thickness]) {
        beams.push({ from: [-width / 2, y, z], to: [width / 2, y, z], thickness });
      }
      for (let i = 0; i < segments; i++) {
        const x = -width / 2 + width * i / segments;
        const next = -width / 2 + width * (i + 1) / segments;
        beams.push({ from: [x, i % 2 ? height - thickness : bottom, z], to: [next, i % 2 ? bottom : height - thickness, z], thickness: thickness * 0.65 });
      }
    }
    const purlins = Math.max(1, Math.ceil(width / 2));
    for (let i = 0; i <= purlins; i++) {
      const x = -width / 2 + width * i / purlins;
      beams.push({ from: [x, height - thickness, -depth / 2], to: [x, height - thickness, depth / 2], thickness });
    }
    return { beams, rows, bottom };
  }, [width, depth, height]);
  useFrame(({ camera }) => {
    if (group.current) {
      camera.getWorldPosition(cameraPoint);
      group.current.worldToLocal(cameraPoint);
      group.current.visible = cameraPoint.y < height;
    }
  });
  return (
    <group ref={group}>
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={texture} color={C.ceilingColor} roughness={0.8} />
      </mesh>
      <RoomFrame beams={beams} />
      {rows.slice(1, -1).map((z) => (
        <mesh key={z} position={[0, bottom - 0.04, z]} raycast={noRaycast}>
          <boxGeometry args={[width * 0.65, 0.025, 0.06]} />
          <meshStandardMaterial color="#f4fbff" emissive="#e6f4ff" emissiveIntensity={1.5} />
        </mesh>
      ))}
    </group>
  );
}


