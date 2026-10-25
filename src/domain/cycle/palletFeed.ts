import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";
import { CYCLE_CONFIG } from "@/constants/cycle";

/**
 * Pallet-unit inbound (conveyor setting inboundUnit "pallet"): loaded pallets spawn on the inbound belt
 * and roll from its end onto the roller-top shuttle AMR parked there. Returns shuttle id -> feeding belt.
 */
export function palletFeeds(objects: readonly SceneEquipment[], settings: Record<string, EquipmentSettings>) {
  const feeds = new Map<string, SceneEquipment>();
  const shuttles = objects.filter((o) => o.kind === "amr" && settings[o.id]?.amrRole === "shuttle");
  for (const belt of objects) {
    const config = settings[belt.id];
    if (belt.kind !== "conveyor" || config?.conveyorRole !== "inbound" || config.inboundUnit !== "pallet") continue;
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

/** True when the conveyor carries pallets (no box spawning, no palletizing from it). */
export const isPalletInbound = (settings: Record<string, EquipmentSettings>, id: string) =>
  settings[id]?.conveyorRole === "inbound" && settings[id]?.inboundUnit === "pallet";
