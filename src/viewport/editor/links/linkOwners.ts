import { resolveLink } from "@/types/links";
import { isForkliftRole, type EquipmentSettings, type SceneEquipment } from "@/types/layout";

/**
 * A pallet mounted on an AMR (settings.mountedOn) is not linkable on its own: the AMR owns its links. The stored link
 * still names the pallet (e.g. `deliver` pallet -> dock, which the simulator reads), but every editor surface shows and
 * edits it through the AMR. Unmounted pallets keep their own links.
 */
type Scene = { objects: readonly SceneEquipment[]; settings: Record<string, EquipmentSettings | undefined> };

export function mountedCarrier(id: string, { objects, settings }: Scene) {
  const on = settings[id]?.mountedOn;
  return on && objects.some((o) => o.id === on && o.kind === "amr") ? on : null;
}

/** The equipment that shows/edits `id`'s links: the carrying AMR for a mounted pallet, otherwise itself. */
export function linkOwner(id: string, scene: Scene) {
  return mountedCarrier(id, scene) ?? id;
}

/** Ids whose links `id` owns: itself plus the pallets mounted on it. */
export function ownedLinkEnds(id: string, scene: Scene) {
  return [id, ...scene.objects.filter((o) => o.kind === "pallet" && mountedCarrier(o.id, scene) === id).map((o) => o.id)];
}

/** Link between two owners (either may act through its mounted pallet), or null. */
export function resolveOwnedLink(a: SceneEquipment, b: SceneEquipment, scene: Scene) {
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  for (const x of ownedLinkEnds(a.id, scene))
    for (const y of ownedLinkEnds(b.id, scene)) {
      if (x === y || linkOwner(x, scene) === linkOwner(y, scene)) continue;
      const link = orientEmptyReturn(resolveLink(byId.get(x)!, byId.get(y)!), byId, scene);
      if (link) return link;
    }
  return null;
}

/** emptyReturn between two AMRs: always plain AMR → forklift (pick order does not matter); two forklifts / two AMRs: no link. */
function orientEmptyReturn<L extends { type: string; from: string; to: string }>(link: L | null, byId: Map<string, SceneEquipment>, { settings }: Scene): L | null {
  if (!link || link.type !== "emptyReturn" || byId.get(link.to)?.kind !== "amr") return link;
  const fork = (id: string) => isForkliftRole(settings[id]?.amrRole);
  if (fork(link.to) && !fork(link.from)) return link;
  if (fork(link.from) && !fork(link.to)) return { ...link, from: link.to, to: link.from };
  return null;
}
