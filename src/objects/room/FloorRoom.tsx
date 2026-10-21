import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { Edges } from "@react-three/drei";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import type { FloorSize } from "@/types/layout";
import { createRoomTexture } from "@/objects/room/roomTextures";
import RoomWall from "./RoomWall";
import RoomRoof from "./RoomRoof";

const noRaycast = () => {};
/** `interactive={false}`: floor, walls and roof ignore pointer rays (simulation mode). */
type Props = FloorSize & { preview?: boolean; interactive?: boolean };
/** A drawn footprint owns its finishes, perimeter frame and connected roof. */
export default function FloorRoom({ width, depth, wallHeight, preview = false, interactive = true }: Props) {
  const floor = useMemo(() => createRoomTexture("floor", width / C.floorTileSize, depth / C.floorTileSize), [width, depth]);
  useEffect(() => () => floor.dispose(), [floor]);
  const room = useRef<Group>(null);
  // Floor, walls and roof only receive shadows: BackSide/cut-away walls and the roof would
  // otherwise darken the whole interior.
  useLayoutEffect(() => {
    room.current?.traverse((node) => {
      node.castShadow = false;
      node.receiveShadow = !preview;
      if (!interactive) node.raycast = noRaycast;
    });
  });
  return (
    <group ref={room}>
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

