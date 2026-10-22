/**
 * Render-only "drop-in" when an auto-layout is applied: the store already holds the final poses; each
 * equipment's inner render group starts DROP_IN.height above its spot and settles to y = 0 (linear),
 * staggered by kind (conveyor -> robot -> pallet -> rack/dock -> AMR) and, within a kind, nearest to the
 * flow start first. Selection, gizmos and saved data use the outer group/store and are unaffected.
 */
import type { EquipmentKind, SceneEquipment } from "@/types/layout";
import { AUTO_LAYOUT_DROP_IN_DURATION_MS, AUTO_LAYOUT_DROP_IN_HEIGHT, AUTO_LAYOUT_DROP_IN_STAGGER_MS } from "@/domain/layout/autoLayout";

export const DROP_IN = { height: AUTO_LAYOUT_DROP_IN_HEIGHT, durationMs: AUTO_LAYOUT_DROP_IN_DURATION_MS, staggerMs: AUTO_LAYOUT_DROP_IN_STAGGER_MS };
const ORDER: Partial<Record<EquipmentKind, number>> = { conveyor: 0, robot: 1, scanner: 1, pallet: 2, rack: 3, dock: 3, amr: 4 };

/** id -> start time (performance.now() ms). Entries are removed by the render group when it lands. */
export const dropInSchedule = new Map<string, number>();

export function scheduleDropIn(objects: readonly SceneEquipment[], now = performance.now()) {
  dropInSchedule.clear();
  const animated = objects.filter((o) => ORDER[o.kind] !== undefined);
  const origin = animated.find((o) => o.kind === "conveyor") ?? { x: 0, z: 0 };
  const sorted = [...animated].sort((a, b) => ORDER[a.kind]! - ORDER[b.kind]! || Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));
  sorted.forEach((object, i) => dropInSchedule.set(object.id, now + i * DROP_IN.staggerMs));
  return sorted.length ? (sorted.length - 1) * DROP_IN.staggerMs + DROP_IN.durationMs : 0;
}

/** Render y offset and opacity for `id` at `now`; null when it is not (or no longer) animating. */
export function dropInState(id: string, now: number): { y: number; opacity: number; done: boolean } | null {
  const start = dropInSchedule.get(id);
  if (start === undefined) return null;
  const t = (now - start) / DROP_IN.durationMs;
  if (t >= 1) return { y: 0, opacity: 1, done: true };
  if (t <= 0) return { y: DROP_IN.height, opacity: 0, done: false };
  return { y: DROP_IN.height * (1 - t), opacity: Math.min(1, t * 2.5), done: false };
}
