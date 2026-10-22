import { DOOR_CONFIG } from "@/constants/door";
import { SIMULATOR_CONFIG } from "@/constants/simulatorLayout";
import type { EquipmentPose, EquipmentSettings, SceneEquipment } from "@/types/layout";

/** Rectangular cut in one wall, in that wall's local frame (x along the wall, from the floor up). */
export type WallOpening = { x0: number; x1: number; top: number };
export type DoorShape = EquipmentPose & { width: number; height: number };

/** three.js rotation about +Y applied to (x, z). */
const rotate = (x: number, z: number, angle: number): [number, number] => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [x * c + z * s, -x * s + z * c];
};

/**
 * The four walls of a floor room in FloorRoom's order (-Z, +Z, -X, +X): wall-group offset and
 * rotation in floor-local space, and wall length. Wall-local +Z faces the room interior.
 */
export function wallFrames(width: number, depth: number) {
  return [
    { cx: 0, cz: -depth / 2, rotation: 0, length: width },
    { cx: 0, cz: depth / 2, rotation: Math.PI, length: width },
    { cx: -width / 2, cz: 0, rotation: Math.PI / 2, length: depth },
    { cx: width / 2, cz: 0, rotation: -Math.PI / 2, length: depth },
  ];
}

/** World point → wall-local (along, offset from the wall plane). */
function toWall(floor: EquipmentPose, frame: ReturnType<typeof wallFrames>[number], x: number, z: number) {
  const [fx, fz] = rotate(x - floor.x, z - floor.z, -floor.yaw);
  return rotate(fx - frame.cx, fz - frame.cz, -frame.rotation);
}

export const doorShape = (object: SceneEquipment, settings: EquipmentSettings | undefined): DoorShape => ({
  x: object.x, z: object.z, yaw: object.yaw,
  width: settings?.doorWidth ?? DOOR_CONFIG.width,
  height: settings?.doorHeight ?? DOOR_CONFIG.height,
});

/**
 * Door pose snapped flush to the nearest wall plane within DOOR_CONFIG.snapDistance, rotated so
 * its local X runs along the wall and kept inside the wall length; unchanged when no wall is near.
 */
export function snapDoorToWall(pose: EquipmentPose, width: number, objects: SceneEquipment[]): EquipmentPose {
  let best: { distance: number; pose: EquipmentPose } | null = null;
  for (const floor of objects) {
    if (floor.kind !== "floor" || !floor.floor || floor.floor.wallHeight <= 0) continue;
    for (const frame of wallFrames(floor.floor.width, floor.floor.depth)) {
      const [along, offset] = toWall(floor, frame, pose.x, pose.z);
      const distance = Math.abs(offset);
      if (distance > DOOR_CONFIG.snapDistance || Math.abs(along) > frame.length / 2 + DOOR_CONFIG.snapDistance) continue;
      if (best && best.distance <= distance) continue;
      const room = frame.length / 2 - width / 2 - DOOR_CONFIG.jamb;
      const snapped = room > 0 ? Math.max(-room, Math.min(room, Math.round(along / SIMULATOR_CONFIG.snap) * SIMULATOR_CONFIG.snap)) : 0;
      const [fx, fz] = rotate(snapped, 0, frame.rotation);
      const [wx, wz] = rotate(frame.cx + fx, frame.cz + fz, floor.yaw);
      best = { distance, pose: { x: floor.x + wx, z: floor.z + wz, yaw: floor.yaw + frame.rotation } };
    }
  }
  return best?.pose ?? pose;
}

/** Openings each of `floor`'s four walls needs for the doors standing in its planes. */
export function wallOpenings(floor: EquipmentPose & { width: number; depth: number; wallHeight: number }, doors: DoorShape[]): WallOpening[][] {
  return wallFrames(floor.width, floor.depth).map((frame) => {
    const openings: WallOpening[] = [];
    for (const door of doors) {
      const [along, offset] = toWall(floor, frame, door.x, door.z);
      if (Math.abs(offset) > DOOR_CONFIG.wallTolerance) continue;
      const x0 = Math.max(-frame.length / 2, along - door.width / 2);
      const x1 = Math.min(frame.length / 2, along + door.width / 2);
      if (x1 - x0 > 1e-3) openings.push({ x0, x1, top: Math.min(door.height, floor.wallHeight) });
    }
    return openings;
  });
}