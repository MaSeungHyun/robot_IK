import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Vector3 } from "three";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import { createRoomTexture } from "@/objects/room/roomTextures";
import RoomFrame from "./RoomFrame";
import type { RoomBeam } from "./RoomFrame";

const noRaycast = () => {};
export default function RoomWall({ length, height, preview }: { length: number; height: number; preview: boolean }) {
  const group = useRef<Group>(null);
  const cameraPoint = useMemo(() => new Vector3(), []);
  const texture = useMemo(() => createRoomTexture("wall", length / C.panelWidth, 1), [length]);
  useEffect(() => () => texture.dispose(), [texture]);
  const baseHeight = Math.min(0.9, height * 0.22);
  const windowBottom = height * 0.67;
  const windowHeight = height * 0.22;
  const beams = useMemo(() => {
    const result: RoomBeam[] = [];
    const bays = Math.max(1, Math.ceil(length / C.baySpacing));
    const thickness = Math.min(0.12, length / 15, height / 15);
    for (let i = 0; i <= bays; i++) {
      const x = -length / 2 + length * i / bays;
      result.push({ from: [x, 0, 0.06], to: [x, height, 0.06], thickness });
    }
    for (const y of [baseHeight, windowBottom, windowBottom + windowHeight, height]) {
      result.push({ from: [-length / 2, y, 0.04], to: [length / 2, y, 0.04], thickness: thickness * 0.6 });
    }
    const panes = Math.ceil(length / C.panelWidth);
    for (let i = 1; i < panes; i++) {
      const x = -length / 2 + length * i / panes;
      result.push({ from: [x, windowBottom, 0.045], to: [x, windowBottom + windowHeight, 0.045], thickness: 0.025 });
    }
    return result;
  }, [length, height, baseHeight, windowBottom, windowHeight]);
  useFrame(({ camera }) => {
    if (group.current) {
      camera.getWorldPosition(cameraPoint);
      group.current.worldToLocal(cameraPoint);
      // Cut away the near wall, including its frame, when viewing from outside.
      group.current.visible = cameraPoint.z >= 0;
    }
  });
  return (
    <group ref={group}>
      <mesh position={[0, height / 2, 0]} raycast={preview ? noRaycast : undefined}>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial map={texture} color={preview ? "#38bdf8" : C.wallColor} roughness={0.75} transparent={preview} opacity={0.35} depthWrite={!preview} />
      </mesh>
      {!preview && <>
        <mesh position={[0, baseHeight / 2, 0.008]} raycast={noRaycast}>
          <planeGeometry args={[length, baseHeight]} />
          <meshStandardMaterial map={texture} color={C.baseColor} roughness={0.65} />
        </mesh>
        <mesh position={[0, windowBottom + windowHeight / 2, 0.012]} raycast={noRaycast}>
          <planeGeometry args={[length, windowHeight]} />
          <meshStandardMaterial color="#dcebf0" emissive="#b9d4e0" emissiveIntensity={0.3} roughness={0.25} metalness={0.15} />
        </mesh>
        <RoomFrame beams={beams} />
      </>}
    </group>
  );
}


