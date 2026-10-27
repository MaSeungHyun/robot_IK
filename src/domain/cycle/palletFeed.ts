import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";
import { CYCLE_CONFIG } from "@/constants/cycle";

/**
 * Pallet-unit inbound (conveyor setting inboundUnit "pallet"): loaded pallets spawn on the inbound belt
 * and roll from its end onto the roller-top shuttle AMR waiting at the receive pose. The receiving AMR is the
 * shuttle linked to the belt (🔗 공급, conveyor → AMR), else the nearest shuttle parked within feedReach of the
 * belt end. Returns shuttle id -> feeding belt.
 */
export function palletFeeds(objects: readonly SceneEquipment[], settings: Record<string, EquipmentSettings>, feedTo: (beltId: string) => readonly string[] = () => []) {
  const feeds = new Map<string, SceneEquipment>();
  const shuttles = objects.filter((o) => o.kind === "amr" && settings[o.id]?.amrRole === "shuttle" && settings[o.id]?.amrCargo !== "box");
  const belts = objects.filter((belt) => belt.kind === "conveyor" && isPalletInbound(settings, belt.id));
  // Linked first, so a proximity match never steals a linked AMR.
  for (const belt of belts) {
    const linked = shuttles.find((s) => !feeds.has(s.id) && feedTo(belt.id).includes(s.id));
    if (linked) feeds.set(linked.id, belt);
  }
  for (const belt of belts) {
    if ([...feeds.values()].includes(belt)) continue;
    const end = beltPoint(belt, beltLength(belt));
    const near = shuttles
      .filter((s) => !feeds.has(s.id))
      .map((s) => ({ s, d: Math.hypot(s.x - end.x, s.z - end.z) }))
      .filter(({ d }) => d <= CYCLE_CONFIG.feedReach)
      .sort((a, b) => a.d - b.d)[0];
    if (near) feeds.set(near.s.id, belt);
  }
  return feeds;
}

/** Where the receiving AMR stands: on the belt axis, feedReceiveGap past the belt end, facing along the belt. */
export function receivePose(belt: SceneEquipment) {
  const end = beltPoint(belt, beltLength(belt));
  return { x: end.x + Math.sin(end.yaw) * CYCLE_CONFIG.feedReceiveGap, z: end.z + Math.cos(end.yaw) * CYCLE_CONFIG.feedReceiveGap, yaw: end.yaw };
}

/** True when the conveyor carries pallets (no box spawning, no palletizing from it). */
export const isPalletInbound = (settings: Record<string, EquipmentSettings>, id: string) =>
  settings[id]?.conveyorRole === "inbound" && settings[id]?.inboundUnit === "pallet";
