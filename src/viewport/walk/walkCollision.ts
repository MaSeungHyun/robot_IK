import { PERSON_COLLISION_RADIUS } from "@/constants/people";
import { footprint } from "@/domain/amr/navigation/layoutNavigation";
import type { SceneEquipment } from "@/types/layout";

/** Oriented floor rectangle (centre, yaw, full width along local x, depth along local z). */
export type WalkRect = { x: number; z: number; yaw: number; w: number; d: number };

/** Walker body radius (m). */
export const WALK_RADIUS = PERSON_COLLISION_RADIUS;
/** Collision thickness of a room wall (m). */
const WALL_THICKNESS = 0.2;
/** Fallback door opening when the door has no width setting (m). */
const DOOR_WIDTH = 4;

const local = (r: WalkRect, x: number, z: number) => {
  const dx = x - r.x, dz = z - r.z, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [dx * c - dz * s, dx * s + dz * c] as const;
};
const inside = (r: WalkRect, x: number, z: number, margin: number) => {
  const [lx, lz] = local(r, x, z);
  return Math.abs(lx) < r.w / 2 + margin && Math.abs(lz) < r.d / 2 + margin;
};
/** Local (lx, lz) of a rect -> world. */
const world = (r: WalkRect, lx: number, lz: number) => {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [r.x + lx * c + lz * s, r.z - lx * s + lz * c] as const;
};

/**
 * Static obstacles for walking: equipment footprints and the four walls of every walled room, with door openings cut
 * out (a door rect, deepened across the wall, lets the walker through).
 */
export function walkObstacles(objects: readonly SceneEquipment[], doorWidth: (id: string) => number | undefined) {
  const solids: WalkRect[] = [], doors: WalkRect[] = [];
  for (const o of objects) {
    if (o.kind === "door") {
      doors.push({ x: o.x, z: o.z, yaw: o.yaw, w: doorWidth(o.id) ?? DOOR_WIDTH, d: 2 });
    } else if (o.kind === "floor") {
      if (!o.floor || o.floor.wallHeight <= 0) continue;
      const { width, depth } = o.floor, room = { x: o.x, z: o.z, yaw: o.yaw, w: width, d: depth };
      for (const [lx, lz, w, d] of [
        [0, -depth / 2, width, WALL_THICKNESS],
        [0, depth / 2, width, WALL_THICKNESS],
        [-width / 2, 0, WALL_THICKNESS, depth],
        [width / 2, 0, WALL_THICKNESS, depth],
      ] as const) {
        const [x, z] = world(room, lx, lz);
        solids.push({ x, z, yaw: o.yaw, w, d });
      }
    } else {
      const [w, d] = footprint(o.kind);
      solids.push({ x: o.x, z: o.z, yaw: o.yaw, w, d });
    }
  }
  return { solids, doors };
}

export type WalkObstacles = ReturnType<typeof walkObstacles>;

export function blocked({ solids, doors }: WalkObstacles, x: number, z: number, radius = WALK_RADIUS) {
  if (doors.some((door) => inside(door, x, z, 0))) {
    // In a doorway only equipment counts, not the wall being passed through.
    return solids.some((r) => r.w > WALL_THICKNESS && r.d > WALL_THICKNESS && inside(r, x, z, radius));
  }
  return solids.some((r) => inside(r, x, z, radius));
}

/**
 * Moves (x, z) by (dx, dz) and slides along whatever blocks it: the full step, else each axis alone. A start already
 * inside an obstacle (spawned in one) may move freely so the walker can get out.
 */
export function slide(obstacles: WalkObstacles, x: number, z: number, dx: number, dz: number): [number, number] {
  if (blocked(obstacles, x, z)) return [x + dx, z + dz];
  if (!blocked(obstacles, x + dx, z + dz)) return [x + dx, z + dz];
  if (!blocked(obstacles, x + dx, z)) return [x + dx, z];
  if (!blocked(obstacles, x, z + dz)) return [x, z + dz];
  return [x, z];
}
