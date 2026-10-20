import { useEffect, useMemo } from "react";
import { Edges } from "@react-three/drei";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import type { FloorSize } from "@/types/layout";
import { createRoomTexture } from "@/utils/scene/roomTextures";
import RoomWall from "./RoomWall";
import RoomRoof from "./RoomRoof";

const noRaycast = () => {};
type Props = FloorSize & { preview?: boolean };
/** A drawn footprint owns its finishes, perimeter frame and connected roof. */
export default function FloorRoom({ width, depth, wallHeight, preview = false }: Props) {
  const floor = useMemo(() => createRoomTexture("floor", width / C.floorTileSize, depth / C.floorTileSize), [width, depth]);
  useEffect(() => () => floor.dispose(), [floor]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} raycast={preview ? noRaycast : undefined} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={preview ? null : floor} color={preview ? "#38bdf8" : C.floorColor} transparent={preview} opacity={preview ? 0.25 : 1} depthWrite={!preview} roughness={0.42} metalness={0.08} />
        <Edges color={preview ? "#38bdf8" : "#87979d"} />
      </mesh>
      {wallHeight > 0 && <>
        <group position={[0, 0, -depth / 2]}><RoomWall length={width} height={wallHeight} preview={preview} /></group>
        <group position={[0, 0, depth / 2]} rotation={[0, Math.PI, 0]}><RoomWall length={width} height={wallHeight} preview={preview} /></group>
        <group position={[-width / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}><RoomWall length={depth} height={wallHeight} preview={preview} /></group>
        <group position={[width / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><RoomWall length={depth} height={wallHeight} preview={preview} /></group>
        {!preview && <RoomRoof width={width} depth={depth} wallHeight={wallHeight} />}
      </>}
    </group>
  );
}

