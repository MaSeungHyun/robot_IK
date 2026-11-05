import type { CycleCircle } from "@/domain/cycle/PalletCycle";

/**
 * Rack-side forklift reservations: the stop pose in front of a rack / Rack_m slot plus the straight approach corridor
 * behind it, held while the forklift has that leg ahead of it. Outbound AMR handoff poses must stay clear of every
 * reservation (an AMR waiting on a forklift's next store / pick stop froze both, t789u).
 */
export type RackReservation = { forkliftId: string; tag: string; circles: CycleCircle[] };

export class RackReservationRegistry {
  private readonly byForklift = new Map<string, RackReservation[]>();

  /** Replaces the forklift's reservation with the same tag. */
  reserve(forkliftId: string, tag: string, circles: CycleCircle[]) {
    const list = (this.byForklift.get(forkliftId) ?? []).filter((r) => r.tag !== tag);
    list.push({ forkliftId, tag, circles });
    this.byForklift.set(forkliftId, list);
  }
  /** Drops one tag, or every reservation of the forklift. */
  release(forkliftId: string, tag?: string) {
    if (tag === undefined) { this.byForklift.delete(forkliftId); return; }
    const list = (this.byForklift.get(forkliftId) ?? []).filter((r) => r.tag !== tag);
    if (list.length) this.byForklift.set(forkliftId, list);
    else this.byForklift.delete(forkliftId);
  }
  clear() {
    this.byForklift.clear();
  }
  all(): readonly RackReservation[] {
    return [...this.byForklift.values()].flat();
  }
  /** First reservation that any of `cs` overlaps (with `margin`), or null. */
  hit(cs: readonly CycleCircle[], margin: number): RackReservation | null {
    for (const r of this.all()) if (cs.some((d) => r.circles.some((o) => Math.hypot(o.x - d.x, o.z - d.z) < o.r + d.r + margin))) return r;
    return null;
  }
}
