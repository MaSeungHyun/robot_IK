import type { EquipmentSettings, SceneEquipment } from "@/types/layout";
import { isForkliftRole } from "@/types/layout";

/** Editor snap radius (m): a pallet dropped this close to a carrier AMR's centre mounts on it. */
export const PALLET_MOUNT_RADIUS = 0.8;

type Scene = { objects: SceneEquipment[]; settings: Record<string, EquipmentSettings> };

/** AMRs a pallet can ride on: shuttles and plain pallet AMRs (not forklifts / AGVs). */
export const canCarryPallet = (settings: EquipmentSettings | undefined) =>
  !isForkliftRole(settings?.amrRole) && settings?.amrRole !== "agv";

/** Free carrier AMR within PALLET_MOUNT_RADIUS of (x, z), nearest first (placement ghost / click snap). */
export function mountCarrierAt(scene: Scene, x: number, z: number): SceneEquipment | undefined {
  const taken = new Set(scene.objects.filter((o) => o.kind === "pallet").map((o) => scene.settings[o.id]?.mountedOn).filter(Boolean));
  return scene.objects
    .filter((o) => o.kind === "amr" && canCarryPallet(scene.settings[o.id]) && !taken.has(o.id))
    .map((o) => ({ o, d: Math.hypot(o.x - x, o.z - z) }))
    .filter(({ d }) => d <= PALLET_MOUNT_RADIUS)
    .sort((a, b) => a.d - b.d)[0]?.o;
}

/**
 * Editor pallet ↔ AMR mounting after `moved` objects changed pose (pure; one store update = one undo step).
 * - A moved pallet within PALLET_MOUNT_RADIUS of a free carrier AMR snaps onto it (same pose, `mountedOn`),
 *   and a plain AMR becomes a shuttle (amrRole "shuttle"); moved elsewhere it is unmounted.
 * - Pallets mounted on a moved AMR follow it.
 */
export function applyPalletMounts(scene: Scene, moved: readonly string[]): Scene {
  const ids = new Set(moved);
  let objects = scene.objects, settings = scene.settings;
  const setConfig = (id: string, patch: Partial<EquipmentSettings>) => {
    settings = { ...settings, [id]: { ...settings[id], ...patch } };
  };
  const setPose = (id: string, carrier: SceneEquipment) => {
    objects = objects.map((o) => (o.id === id ? { ...o, x: carrier.x, z: carrier.z, yaw: carrier.yaw } : o));
  };
  for (const pallet of scene.objects.filter((o) => o.kind === "pallet" && ids.has(o.id))) {
    const taken = new Set(objects.filter((o) => o.kind === "pallet" && o.id !== pallet.id).map((o) => settings[o.id]?.mountedOn).filter(Boolean));
    const carrier = objects
      .filter((o) => o.kind === "amr" && canCarryPallet(settings[o.id]) && !taken.has(o.id))
      .map((o) => ({ o, d: Math.hypot(o.x - pallet.x, o.z - pallet.z) }))
      .filter(({ d }) => d <= PALLET_MOUNT_RADIUS)
      .sort((a, b) => a.d - b.d)[0]?.o;
    if (carrier) {
      setPose(pallet.id, carrier);
      if (settings[pallet.id]?.mountedOn !== carrier.id) setConfig(pallet.id, { mountedOn: carrier.id });
      if (settings[carrier.id]?.amrRole !== "shuttle") setConfig(carrier.id, { amrRole: "shuttle" });
    } else if (settings[pallet.id]?.mountedOn) {
      const next = { ...settings[pallet.id] };
      delete next.mountedOn;
      settings = { ...settings, [pallet.id]: next };
    }
  }
  for (const amr of objects.filter((o) => o.kind === "amr" && ids.has(o.id)))
    for (const pallet of objects.filter((o) => o.kind === "pallet" && !ids.has(o.id) && settings[o.id]?.mountedOn === amr.id)) setPose(pallet.id, amr);
  return { objects, settings };
}

/** Removing `id`: pallets mounted on it are unmounted (they stay where they are). */
export function releaseMounts(settings: Record<string, EquipmentSettings>, id: string) {
  let next = settings;
  for (const [palletId, config] of Object.entries(settings))
    if (config.mountedOn === id) {
      const copy = { ...config };
      delete copy.mountedOn;
      next = { ...next, [palletId]: copy };
    }
  return next;
}
