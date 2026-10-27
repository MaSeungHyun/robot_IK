import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import { footprint, loadedStopClear } from "@/domain/amr/navigation/layoutNavigation";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";
import { CONVEYOR_LAYOUT as BELT } from "@/constants/conveyorLayoutConfig";
import { MODEL_FOOTPRINT as F } from "@/constants/footprints";
import { ROBOT_PICKING } from "@/constants/simulation";

/** Prefix of the sim-only stop poses next to depalletizing robots (they act as unload docks, never rendered). */
export const ROBOT_STOP_PREFIX = "robotstop:";
/** Free space (m) kept between the stopped AMR body and other equipment. */
const STOP_CLEARANCE = 0.2;

const local = (o: { x: number; z: number; yaw: number }, x: number, z: number) => {
  const dx = x - o.x, dz = z - o.z, c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};

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

/** Smallest distance from `p` to any obstacle edge (<= 0: inside one). */
function clearance(p: { x: number; z: number }, obstacles: readonly SceneEquipment[], robot: SceneEquipment) {
  let best = Infinity;
  for (const o of obstacles) {
    if (o.kind === "conveyor") {
      const length = beltLength(o), steps = Math.max(1, Math.ceil(length / 0.25));
      for (let k = 0; k <= steps; k++) {
        const b = beltPoint(o, (length * k) / steps);
        best = Math.min(best, Math.hypot(p.x - b.x, p.z - b.z) - BELT.width / 2);
      }
      continue;
    }
    if (o === robot) { best = Math.min(best, Math.hypot(p.x - o.x, p.z - o.z) - F.robotRadius); continue; }
    const [w, l] = footprint(o.kind), q = local(o, p.x, p.z);
    const ox = Math.abs(q.x) - w / 2, oz = Math.abs(q.z) - l / 2;
    best = Math.min(best, ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz));
  }
  return best;
}

/**
 * Stop pose for an AMR delivering a pallet to a depalletizing robot, replacing a placed unload dock: on a ring around the
 * robot as close as the route planner lets a loaded AMR stop (pallet centre inside the pick reach), the AMR body (plus clearance) is free of other equipment, and
 * the AMR stands side-on to the robot (heading tangent to the ring). Null when no free pose fits.
 */
export function robotStopPose(robot: SceneEquipment, reach: number, objects: readonly SceneEquipment[]) {
  const obstacles = objects.filter((o) => o.kind !== "amr" && o.kind !== "dock" && o.kind !== "door" && o.kind !== "floor");
  // Pallet centre must stay inside the pick reach; the closest free ring keeps the most boxes in reach.
  const far = reach - ROBOT_PICKING.pickReachMargin;
  const others = obstacles.filter((o) => o !== robot);
  // Pallet held square to the floor axes (inbound belts run along x or z); either way it must fit.
  const planner = (x: number, z: number) => loadedStopClear(robot, x, z, 0, others) && loadedStopClear(robot, x, z, Math.PI / 2, others);
  const near = F.robotRadius + F.amr[0] / 2 + STOP_CLEARANCE;
  let best: { x: number; z: number; yaw: number; score: number } | null = null;
  for (let d = near; d <= far; d += 0.05) {
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180, x = robot.x + Math.sin(a) * d, z = robot.z + Math.cos(a) * d;
      const pose = { x, z, yaw: a + Math.PI / 2 };
      const free = Math.min(...bodyPoints(pose).map((p) => clearance(p, obstacles, robot)));
      // The loaded AMR must also be able to stop there per the route planner (loaded envelope clear of every equipment).
      if (free <= 0 || !planner(x, z)) continue;
      // Largest free margin on the innermost ring that fits.
      if (!best || free > best.score) best = { ...pose, score: free };
    }
    if (best) break;
  }
  return best && { x: best.x, z: best.z, yaw: best.yaw };
}

/**
 * Sim-only unload stops: every depalletizing robot without a placed unload/stage dock in reach gets one stop pose next to it
 * (acts as its unload dock: one AMR booked at a time, the next waits at the staging distance). Placed docks still work.
 */
export function withRobotStops(objects: SceneEquipment[], getSettings: () => Record<string, EquipmentSettings>) {
  const base = getSettings();
  const docks = objects.filter((o) => o.kind === "dock" && (base[o.id]?.dockRole === "unload" || base[o.id]?.dockRole === "stage"));
  const extra: SceneEquipment[] = [];
  for (const robot of objects) {
    if (robot.kind !== "robot" || base[robot.id]?.robotRole !== "depalletize") continue;
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