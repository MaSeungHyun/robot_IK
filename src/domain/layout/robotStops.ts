import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import { footprint, loadedStopClear } from "@/domain/amr/navigation/layoutNavigation";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { MODEL_FOOTPRINT as F } from "@/constants/footprints";
import { ROBOT_PICKING } from "@/constants/simulation";
import { isDepalletizer } from "@/domain/robot/robotRole";

/** Prefix of the sim-only stop poses next to depalletizing robots (they act as unload docks, never rendered). */
export const ROBOT_STOP_PREFIX = "robotstop:";
/** Free space (m) kept between the stopped AMR body and other equipment. */
const STOP_CLEARANCE = 0.2;

/** AMR body sample points (inflated by STOP_CLEARANCE) at a pose. */
function bodyPoints(pose: { x: number; z: number; yaw: number }) {
  const hw = F.amr[0] / 2 + STOP_CLEARANCE, hl = F.amr[1] / 2 + STOP_CLEARANCE, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const lx = -hw + (2 * hw * i) / 4, lz = -hl + (2 * hl * j) / 4;
    points.push({ x: pose.x + lx * c + lz * s, z: pose.z - lx * s + lz * c });
  }
  return points;
}

/** Obstacle prepared once per search: belt samples, box frame, or the robot's own disc. */
type Obstacle =
  | { type: "belt"; points: { x: number; z: number }[]; minX: number; maxX: number; minZ: number; maxZ: number; near: number }
  | { type: "robot"; x: number; z: number; near: number }
  | { type: "box"; x: number; z: number; c: number; s: number; hw: number; hl: number; near: number };

const beltCache = new WeakMap<SceneEquipment, { x: number; z: number }[]>();

/** Belt sampled every 0.25 m (same samples the clearance used to recompute per query), once per conveyor object. */
function beltSamples(o: SceneEquipment) {
  const cached = beltCache.get(o);
  if (cached) return cached;
  const length = beltLength(o), steps = Math.max(1, Math.ceil(length / 0.25)), points: { x: number; z: number }[] = [];
  for (let k = 0; k <= steps; k++) { const b = beltPoint(o, (length * k) / steps); points.push({ x: b.x, z: b.z }); }
  beltCache.set(o, points);
  return points;
}

function prepare(obstacles: readonly SceneEquipment[], robot: SceneEquipment): Obstacle[] {
  const list = obstacles.map((o): Obstacle => {
    if (o.kind === "conveyor") {
      const points = beltSamples(o);
      const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
      return { type: "belt", points, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), near: Math.min(...points.map((p) => Math.hypot(p.x - robot.x, p.z - robot.z))) };
    }
    if (o === robot) return { type: "robot", x: o.x, z: o.z, near: 0 };
    const [w, l] = footprint(o.kind);
    return { type: "box", x: o.x, z: o.z, c: Math.cos(o.yaw), s: Math.sin(o.yaw), hw: w / 2, hl: l / 2, near: Math.hypot(o.x - robot.x, o.z - robot.z) };
  });
  // Nearest first so the cut-off below triggers early (min is order independent).
  return list.sort((p, q) => p.near - q.near);
}

/** Smallest distance from `p` to any obstacle edge (<= 0: inside one); stops once it is <= `cutoff` (result rejected anyway). */
function clearance(p: { x: number; z: number }, obstacles: readonly Obstacle[], cutoff: number) {
  let best = Infinity;
  for (const o of obstacles) {
    if (o.type === "belt") {
      // Bounding-box lower bound: a belt farther than the current minimum cannot lower it.
      const bx = Math.max(o.minX - p.x, 0, p.x - o.maxX), bz = Math.max(o.minZ - p.z, 0, p.z - o.maxZ);
      if (Math.hypot(bx, bz) - BELT.width / 2 >= best) continue;
      for (const b of o.points) best = Math.min(best, Math.hypot(p.x - b.x, p.z - b.z) - BELT.width / 2);
    } else if (o.type === "robot") best = Math.min(best, Math.hypot(p.x - o.x, p.z - o.z) - F.robotRadius);
    else {
      const dx = p.x - o.x, dz = p.z - o.z, qx = dx * o.c - dz * o.s, qz = dx * o.s + dz * o.c;
      const ox = Math.abs(qx) - o.hw, oz = Math.abs(qz) - o.hl;
      best = Math.min(best, ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz));
    }
    if (best <= cutoff) return best;
  }
  return best;
}

/** Stop poses per layout snapshot (objects array) and robot pose/reach: rebuilding the simulator reuses them. */
const poseCache = new WeakMap<readonly SceneEquipment[], Map<string, { x: number; z: number; yaw: number } | null>>();

/**
 * Stop pose for an AMR delivering a pallet to a depalletizing robot, replacing a placed unload dock: on a ring around the
 * robot as close as the route planner lets a loaded AMR stop (pallet centre inside the pick reach), the AMR body (plus clearance) is free of other equipment, and
 * the AMR stands side-on to the robot (heading tangent to the ring). Null when no free pose fits.
 */
export function robotStopPose(robot: SceneEquipment, reach: number, objects: readonly SceneEquipment[]) {
  const key = `${robot.id}|${robot.x}|${robot.z}|${robot.yaw}|${reach}`;
  let cache = poseCache.get(objects);
  if (!cache) poseCache.set(objects, (cache = new Map()));
  if (cache.has(key)) return cache.get(key) ?? null;
  const raw = obstacles(objects);
  const prepared = prepare(raw, robot);
  // Pallet centre must stay inside the pick reach; the closest free ring keeps the most boxes in reach.
  const far = reach - ROBOT_PICKING.pickReachMargin;
  const others = raw.filter((o) => o !== robot);
  // Pallet held square to the floor axes (inbound belts run along x or z); either way it must fit.
  const planner = (x: number, z: number) => loadedStopClear(robot, x, z, 0, others) && loadedStopClear(robot, x, z, Math.PI / 2, others);
  const near = F.robotRadius + F.amr[0] / 2 + STOP_CLEARANCE;
  let best: { x: number; z: number; yaw: number; score: number } | null = null;
  for (let d = near; d <= far; d += 0.05) {
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180, x = robot.x + Math.sin(a) * d, z = robot.z + Math.cos(a) * d;
      const pose = { x, z, yaw: a + Math.PI / 2 };
      // Only a larger free margin than the current best (and > 0) is kept: stop measuring once below it.
      const cutoff = best ? best.score : 0;
      let free = Infinity;
      for (const p of bodyPoints(pose)) { free = Math.min(free, clearance(p, prepared, cutoff)); if (free <= cutoff) break; }
      // The loaded AMR must also be able to stop there per the route planner (loaded envelope clear of every equipment).
      if (free <= cutoff || !planner(x, z)) continue;
      // Largest free margin on the innermost ring that fits.
      best = { ...pose, score: free };
    }
    if (best) break;
  }
  const result = best && { x: best.x, z: best.z, yaw: best.yaw };
  cache.set(key, result);
  return result;
}

const obstacles = (objects: readonly SceneEquipment[]) => objects.filter((o) => o.kind !== "amr" && o.kind !== "dock" && o.kind !== "door" && o.kind !== "floor");

/**
 * Sim-only unload stops: every depalletizing robot without a placed unload/stage dock in reach gets one stop pose next to it
 * (acts as its unload dock: one AMR booked at a time, the next waits at the staging distance). Placed docks still work.
 */
export function withRobotStops(objects: SceneEquipment[], getSettings: () => Record<string, EquipmentSettings>) {
  const base = getSettings();
  const docks = objects.filter((o) => o.kind === "dock" && (base[o.id]?.dockRole === "unload" || base[o.id]?.dockRole === "stage"));
  const extra: SceneEquipment[] = [];
  for (const robot of objects) {
    if (robot.kind !== "robot" || !isDepalletizer(base[robot.id])) continue;
    const reach = base[robot.id]?.reach ?? 2.5;
    if (docks.some((d) => Math.hypot(d.x - robot.x, d.z - robot.z) <= reach + 1.5)) continue;
    const pose = robotStopPose(robot, reach, objects);
    if (pose) extra.push({ id: `${ROBOT_STOP_PREFIX}${robot.id}`, kind: "dock", name: `${robot.name} 정차 위치`, ...pose });
  }
  if (!extra.length) return { objects, getSettings };
  let last: Record<string, EquipmentSettings> | null = null, merged: Record<string, EquipmentSettings> = {};
  const wrapped = () => {
    const current = getSettings();
    if (current === last) return merged;
    last = current;
    merged = { ...current };
    for (const stop of extra) {
      const robot = current[stop.id.slice(ROBOT_STOP_PREFIX.length)];
      merged[stop.id] = { speed: 1, reach: 0, capacity: 40, spawnInterval: 8, enabled: robot?.enabled !== false, dockRole: "unload" };
    }
    return merged;
  };
  return { objects: [...objects, ...extra], getSettings: wrapped };
}