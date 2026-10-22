import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { Edges } from "@react-three/drei";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import type { EquipmentPose, FloorSize } from "@/types/layout";
import { useSceneStore } from "@/stores/useSceneStore";
import { doorShape, wallOpenings } from "@/domain/room/roomWalls";
import { createRoomTexture } from "@/objects/room/roomTextures";
import { useRoomMaps } from "@/objects/room/roomMaterials";
import RoomWall from "./RoomWall";
import RoomRoof from "./RoomRoof";

const noRaycast = () => {};
/** `interactive={false}`: floor, walls and roof ignore pointer rays (simulation mode). */
type Props = FloorSize & { preview?: boolean; interactive?: boolean; /** World pose of the room; doors standing in its wall planes cut openings. */ pose?: EquipmentPose };
/** A drawn footprint owns its finishes, perimeter frame and connected roof. */
export default function FloorRoom({ width, depth, wallHeight, preview = false, interactive = true, pose }: Props) {
  const openings = useWallOpenings(pose, width, depth, wallHeight);
  const floor = useMemo(() => createRoomTexture("floor", width / C.floorTileSize, depth / C.floorTileSize), [width, depth]);
  useEffect(() => () => floor.dispose(), [floor]);
  // Grey concrete slabs (in-house PBR); flat procedural fallback on the performance tier.
  const pbr = useRoomMaps("floor", width, depth);
  const room = useRef<Group>(null);
  // Floor, walls and roof only receive shadows: BackSide/cut-away walls and the roof would
  // otherwise darken the whole interior.
  useLayoutEffect(() => {
    room.current?.traverse((node) => {
      node.castShadow = false;
      node.receiveShadow = !preview;
      if (!interactive) node.raycast = noRaycast;
      else if (node.raycast === noRaycast && !preview) delete (node as { raycast?: unknown }).raycast;
    });
  });
  return (
    <group ref={room}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} raycast={preview ? noRaycast : undefined} receiveShadow>
        <planeGeometry args={[width, depth]} />
        {pbr && !preview ? (
          <meshStandardMaterial key="pbr" {...pbr} color="#ffffff" roughness={1} metalness={0} normalScale={[0.6, 0.6]} />
        ) : (
          <meshStandardMaterial key="flat" map={preview ? null : floor} color={preview ? "#38bdf8" : C.floorColor} transparent={preview} opacity={preview ? 0.25 : 1} depthWrite={!preview} roughness={0.42} metalness={0.08} />
        )}
        <Edges color={preview ? "#38bdf8" : "#87979d"} />
      </mesh>
      {wallHeight > 0 && <>
        <group position={[0, 0, -depth / 2]}><RoomWall length={width} height={wallHeight} preview={preview} openings={openings?.[0]} /></group>
        <group position={[0, 0, depth / 2]} rotation={[0, Math.PI, 0]}><RoomWall length={width} height={wallHeight} preview={preview} openings={openings?.[1]} /></group>
        <group position={[-width / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}><RoomWall length={depth} height={wallHeight} preview={preview} openings={openings?.[2]} /></group>
        <group position={[width / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><RoomWall length={depth} height={wallHeight} preview={preview} openings={openings?.[3]} /></group>
        {!preview && <RoomRoof width={width} depth={depth} wallHeight={wallHeight} />}
      </>}
    </group>
  );
}


/**
 * Door cuts per wall (FloorRoom wall order). Subscribes to a compact key of door poses/sizes, so
 * walls rebuild only when a door or this room changes (not on open/close or unrelated edits).
 */
function useWallOpenings(pose: EquipmentPose | undefined, width: number, depth: number, wallHeight: number) {
  const key = useSceneStore((state) => {
    if (!pose || wallHeight <= 0) return "";
    let result = "";
    for (const object of state.objects) {
      if (object.kind !== "door") continue;
      const d = doorShape(object, state.settings[object.id]);
      result += `${d.x},${d.z},${d.yaw},${d.width},${d.height};`;
    }
    return result;
  });
  const x = pose?.x, z = pose?.z, yaw = pose?.yaw;
  return useMemo(() => {
    if (!key || x === undefined || z === undefined || yaw === undefined) return null;
    const doors = key.split(";").filter(Boolean).map((entry) => {
      const [dx, dz, dyaw, w, h] = entry.split(",").map(Number);
      return { x: dx, z: dz, yaw: dyaw, width: w, height: h };
    });
    return wallOpenings({ x, z, yaw, width, depth, wallHeight }, doors);
  }, [key, x, z, yaw, width, depth, wallHeight]);
}
