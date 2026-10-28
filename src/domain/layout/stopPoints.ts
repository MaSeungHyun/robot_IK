import type { EquipmentSettings, SceneEquipment, StopRole } from "@/types/layout";
import type { SceneLink } from "@/types/links";
import { robotStopPose } from "@/domain/layout/robotStops";

/** Prefix of the sim-only docks built from equipment `stopPoints` (floor-click stop points; replace placed docks). */
export const STOP_POINT_PREFIX = "stop:";

const isForklift = (config: EquipmentSettings | undefined) => (config?.amrRole === "forklift" || config?.amrRole === "rack");

/**
 * Sim-only docks from `stopPoints` (unload/service/ship/stage/rackDrop points owned by a robot, forklift, AGV or AMR),
 * plus an auto service stop next to a forklift that a pallet is 🔗 delivered to but that has no service point.
 * Every dock-based cycle rule keeps working on these; placed docks are only empty-pallet stacks now.
 */
export function withStopPoints(objects: SceneEquipment[], getSettings: () => Record<string, EquipmentSettings>, links: readonly SceneLink[]) {
  const base = getSettings();
  const extra: { dock: SceneEquipment; owner: string; role: StopRole; acceptGrade?: EquipmentSettings["acceptGrade"] }[] = [];
  for (const owner of objects) {
    (base[owner.id]?.stopPoints ?? []).forEach((p, i) => extra.push({
      dock: { id: `${STOP_POINT_PREFIX}${owner.id}:${i}`, kind: "dock", name: `${owner.name} 정차 위치 ${i + 1}`, x: p.x, z: p.z, yaw: p.yaw ?? 0 },
      owner: owner.id, role: p.role, acceptGrade: p.acceptGrade,
    }));
  }
  for (const owner of objects) {
    if (owner.kind !== "amr" || !isForklift(base[owner.id]) || extra.some((e) => e.owner === owner.id && e.role === "service")) continue;
    if (!links.some((l) => l.type === "deliver" && l.to === owner.id)) continue;
    const pose = robotStopPose(owner, 2.5, objects);
    if (pose) extra.push({ dock: { id: `${STOP_POINT_PREFIX}${owner.id}:auto`, kind: "dock", name: `${owner.name} 교체 위치`, ...pose }, owner: owner.id, role: "service" });
  }
  if (!extra.length) return { objects, getSettings };
  let last: Record<string, EquipmentSettings> | null = null, merged: Record<string, EquipmentSettings> = {};
  const wrapped = () => {
    const current = getSettings();
    if (current === last) return merged;
    last = current;
    merged = { ...current };
    for (const e of extra)
      merged[e.dock.id] = { speed: 1, reach: 0, capacity: 40, spawnInterval: 8, enabled: current[e.owner]?.enabled !== false, dockRole: e.role, ...(e.acceptGrade ? { acceptGrade: e.acceptGrade } : {}) };
    return merged;
  };
  return { objects: [...objects, ...extra.map((e) => e.dock)], getSettings: wrapped };
}

/** 🔗 deliver links to a robot/forklift/AMR point at its stop docks (its stop points, the auto robot/forklift stop). */
export function remapStopLinks(links: readonly SceneLink[], objects: readonly SceneEquipment[]): SceneLink[] {
  const kinds = new Map(objects.map((o) => [o.id, o.kind]));
  return links.flatMap((link) => {
    const kind = kinds.get(link.to);
    if (link.type !== "deliver" || (kind !== "robot" && kind !== "amr")) return [link];
    const stops = objects.filter((o) => o.kind === "dock" && (o.id.startsWith(`${STOP_POINT_PREFIX}${link.to}:`) || o.id === `robotstop:${link.to}`));
    return stops.length ? stops.map((s, i) => ({ ...link, id: `${link.id}:${i}`, to: s.id })) : [link];
  });
}