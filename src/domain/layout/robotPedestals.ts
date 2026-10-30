import { Box3, Vector3, type Object3D } from "three";
import { ROBOT_PEDESTAL_FOOTPRINTS, ROBOT_PEDESTAL_PALLET_POINTS, ROBOT_PEDESTALS, type RobotPedestalKind } from "@/constants/robotPedestal";

/** Pedestal yaw relative to the robot (radians) from the robotPedestalYaw setting (degrees). */
export function pedestalYawOffset(settings: { robotPedestalYaw?: number } | undefined): number {
  const degrees = settings?.robotPedestalYaw ?? 0;
  return Number.isFinite(degrees) ? (degrees * Math.PI) / 180 : 0;
}

/** Arm base height: the chosen pedestal's *_point height, else the stored elevation (decor pedestal / floor). */
export function robotElevation(object: { elevation?: number }, pedestal: RobotPedestalKind | undefined): number {
  return pedestal && pedestal !== "none" ? ROBOT_PEDESTALS[pedestal].elevation : object.elevation ?? 0;
}

type PedestalObjects = readonly { id: string; kind: string; x: number; z: number; yaw: number }[];
type PedestalSettings = Record<string, { robotPedestal?: RobotPedestalKind; robotPedestalYaw?: number; mountedOn?: string } | undefined>;

/**
 * Where a fixed pallet on a pedestal with a "pallet_point" empty stands (world centre x/z, base y), turned with the
 * robot yaw + robotPedestalYaw. Null when the pallet is mounted, on no pedestal, or the pedestal has no pallet_point.
 */
export function palletPedestalPose(pallet: { x: number; z: number }, objects: PedestalObjects, settings: PedestalSettings, palletId?: string): { x: number; y: number; z: number } | null {
  if (palletId && settings[palletId]?.mountedOn) return null;
  for (const robot of objects) {
    const kind = robot.kind === "robot" ? settings[robot.id]?.robotPedestal : undefined;
    const point = kind && kind !== "none" ? ROBOT_PEDESTAL_PALLET_POINTS[kind] : undefined;
    if (!kind || kind === "none" || !point) continue;
    const dx = pallet.x - robot.x, dz = pallet.z - robot.z, yaw = robot.yaw + pedestalYawOffset(settings[robot.id]), c = Math.cos(yaw), s = Math.sin(yaw);
    const x = dx * c - dz * s, z = dx * s + dz * c, f = ROBOT_PEDESTAL_FOOTPRINTS[kind];
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    return { x: robot.x + point.x * c + point.z * s, y: ROBOT_PEDESTALS[kind].elevation + point.y, z: robot.z - point.x * s + point.z * c };
  }
  return null;
}

/**
 * Height a fixed pallet stands at: a robot pedestal's top when the pallet centre is on one (robot settings
 * robotPedestal), else the floor (0). Pallets mounted on a shuttle are not floor pallets (0).
 */
export function palletBaseY(
  pallet: { x: number; z: number },
  objects: readonly { id: string; kind: string; x: number; z: number; yaw: number }[],
  settings: Record<string, { robotPedestal?: RobotPedestalKind; robotPedestalYaw?: number; mountedOn?: string } | undefined>,
  palletId?: string,
): number {
  if (palletId && settings[palletId]?.mountedOn) return 0;
  const pose = palletPedestalPose(pallet, objects, settings, palletId);
  if (pose) return pose.y;
  let best = 0;
  for (const robot of objects) {
    const kind = robot.kind === "robot" ? settings[robot.id]?.robotPedestal : undefined;
    if (!kind || kind === "none") continue;
    const dx = pallet.x - robot.x, dz = pallet.z - robot.z, yaw = robot.yaw + pedestalYawOffset(settings[robot.id]), c = Math.cos(yaw), s = Math.sin(yaw);
    const x = dx * c - dz * s, z = dx * s + dz * c, f = ROBOT_PEDESTAL_FOOTPRINTS[kind];
    if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) best = Math.max(best, ROBOT_PEDESTALS[kind].elevation);
  }
  return best;
}

/**
 * Robot pedestals (robot_base / robot_arm_place GLB props): world-space footprint + top surface.
 * A robot added (or moved) over one stands on its "*_point" empty (robot_arm_point / robot_base_point) when the GLB
 * has one; otherwise on the bbox top face (SceneEquipment.elevation).
 *  - robot_base: arm pedestal -> robot snaps to its XZ centre on add.
 *  - robot_arm_place: larger work platform -> robot keeps the cursor XZ (clamped inside the top), only lifted.
 */
export type RobotPedestal = { kind: "base" | "place"; minX: number; maxX: number; minZ: number; maxZ: number; top: number; cx: number; cz: number; point?: { x: number; y: number; z: number } };

const PEDESTAL_RE = /^(robot_?(arm_?)?base|robot_arm_place)/i;
const pedestals = new Map<string, RobotPedestal>();
const box = new Box3();
const listeners = new Set<() => void>();
/** Called whenever a pedestal is registered/unregistered (GLB props load asynchronously after the scene). */
export function onRobotPedestalsChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
// Deferred + coalesced: registration runs inside GlbProps' render (useMemo), where store updates are not allowed.
let queued = false;
const notify = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; listeners.forEach((listener) => listener()); }); };

export function isRobotPedestalName(name: string) { return PEDESTAL_RE.test(name); }

/** Registers the pedestal(s) under `root` (world transform must be current). Returns the keys for unregister. */
export function registerRobotPedestal(root: Object3D, name: string): string | null {
  if (!isRobotPedestalName(name)) return null;
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  if (box.isEmpty()) return null;
  const key = root.uuid;
  let empty: Object3D | undefined;
  root.traverse((o) => { if (!empty && o !== root && /_point$/i.test(o.name)) empty = o; });
  const p = empty?.getWorldPosition(new Vector3());
  pedestals.set(key, {
    kind: /place/i.test(name) ? "place" : "base",
    minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, top: box.max.y,
    cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2,
    point: p ? { x: p.x, y: p.y, z: p.z } : undefined,
  });
  notify();
  return key;
}
export function unregisterRobotPedestal(key: string) { if (pedestals.delete(key)) notify(); }

/** Smallest pedestal whose footprint contains (x, z). */
export function robotPedestalAt(x: number, z: number): RobotPedestal | undefined {
  let best: RobotPedestal | undefined, area = Infinity;
  for (const p of pedestals.values()) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    const a = (p.maxX - p.minX) * (p.maxZ - p.minZ);
    if (a < area) { area = a; best = p; }
  }
  return best;
}

/** Robot pose on a pedestal: `centre` snaps XZ to a robot_base centre (used on add). Floor -> elevation 0. */
export function robotMountAt(x: number, z: number, centre: boolean): { x: number; z: number; elevation: number } {
  const p = robotPedestalAt(x, z);
  if (!p) return { x, z, elevation: 0 };
  // Authored mount point: snap to it on add, keep its height while dragging over the pedestal.
  if (p.point) return centre ? { x: p.point.x, z: p.point.z, elevation: p.point.y } : { x, z, elevation: p.point.y };
  if (centre && p.kind === "base") return { x: p.cx, z: p.cz, elevation: p.top };
  return { x, z, elevation: p.top };
}
