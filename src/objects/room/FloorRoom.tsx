import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { Edges } from "@react-three/drei";
import { FACTORY_ROOM as C } from "@/constants/factoryRoom";
import type { EquipmentPose, FloorSize } from "@/types/layout";
import { useSceneStore } from "@/stores/useSceneStore";
import { doorShape, wallOpenings } from "@/domain/room/roomWalls";
import { createRoomTexture } from "@/objects/room/roomTextures";
import { useKitMaterials } from "@/objects/room/kit/kitMaterials";
import { buildKitFloor } from "@/objects/room/kit/floorKit";
import RoomWall from "./RoomWall";
import RoomRoof from "./RoomRoof";

const noRaycast = () => {};
/** `interactive={false}`: floor, walls and roof ignore pointer rays (simulation mode). */
type Props = FloorSize & { preview?: boolean; interactive?: boolean; /** World pose of the room; doors standing in its wall planes cut openings. */ pose?: EquipmentPose };
/** A drawn footprint owns its finishes, perimeter frame and connected roof. */
export default function FloorRoom({ width, depth, wallHeight, roof = true, glbShell = false, preview = false, interactive = true, pose }: Props) {
  const openings = useWallOpenings(pose, width, depth, wallHeight);
  const floor = useMemo(() => createRoomTexture("floor", width / C.floorTileSize, depth / C.floorTileSize), [width, depth]);
  useEffect(() => () => floor.dispose(), [floor]);
  // Enviroment BG_Floor kit (glb material, world-space glb UVs); flat procedural fallback on the performance tier.
  const kit = useKitMaterials();
  const px = pose?.x ?? 0, pz = pose?.z ?? 0, pyaw = pose?.yaw ?? 0;
  const kitFloor = useMemo(() => (kit && !preview && !glbShell ? buildKitFloor(width, depth, { x: px, z: pz, yaw: pyaw }) : null), [kit, preview, glbShell, width, depth, px, pz, pyaw]);
  useEffect(() => () => kitFloor?.dispose(), [kitFloor]);
  const room = useRef<Group>(null);
  // Walls, frame and roof carry baked shading: no shadows at all (cut-away walls and the roof would
  // darken the interior). Only the floor receives the moving equipment shadows.
  useLayoutEffect(() => {
    room.current?.traverse((node) => {
      node.castShadow = false;
      node.receiveShadow = !preview && node.userData.shadowFloor === true;
      if (!interactive) node.raycast = noRaycast;
      else if (node.raycast === noRaycast && !preview) delete (node as { raycast?: unknown }).raycast;
    });
  });
  // glb shell (factory.glb "Enviroment" walls + BG_Floor): no kit floor / walls / roof; only an invisible plane at floor
  // height so floor clicks (stop points, placement) still hit (the glb props never raycast).
  if (glbShell && !preview) return (
    <group ref={room}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  );
  return (
    <group ref={room}>
      {kitFloor && kit ? (
        <mesh geometry={kitFloor} material={kit.floor} position={[0, 0.003, 0]} userData={{ shadowFloor: true }} receiveShadow>
          <Edges color="#87979d" />
        </mesh>
      ) : (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} raycast={preview ? noRaycast : undefined} userData={{ shadowFloor: true }} receiveShadow>
        <planeGeometry args={[width, depth]} />
        {(
          <meshStandardMaterial key="flat" map={preview ? null : floor} color={preview ? "#02dfef" : C.floorColor} transparent={preview} opacity={preview ? 0.25 : 1} depthWrite={!preview} roughness={0.42} metalness={0.08} />
        )}
        <Edges color={preview ? "#02dfef" : "#87979d"} />
      </mesh>
      )}
      {wallHeight > 0 && <>
        <group position={[0, 0, -depth / 2]}><RoomWall length={width} height={wallHeight} preview={preview} openings={openings?.[0]} /></group>
        <group position={[0, 0, depth / 2]} rotation={[0, Math.PI, 0]}><RoomWall length={width} height={wallHeight} preview={preview} openings={openings?.[1]} /></group>
        <group position={[-width / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}><RoomWall length={depth} height={wallHeight} preview={preview} openings={openings?.[2]} /></group>
        <group position={[width / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><RoomWall length={depth} height={wallHeight} preview={preview} openings={openings?.[3]} /></group>
        {!preview && roof && <RoomRoof width={width} depth={depth} wallHeight={wallHeight} />}
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
