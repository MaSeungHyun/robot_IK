import type { EquipmentKind } from "@/types/layout";

/**
 * Equipment relation (🔗). Direction follows the material flow, except `pickup` (AMR -> the
 * pallet station it serves). Equipment without links of a type keeps the distance-based fallback.
 */
export type LinkType = "feed" | "load" | "pickup" | "deliver" | "emptyReturn";

export type SceneLink = { id: string; type: LinkType; from: string; to: string };

/** Template form: endpoints are indices into `SceneTemplate.equipment`. */
export type TemplateLink = { type: LinkType; from: number; to: number };

export const LINK_RULES: Record<LinkType, { from: EquipmentKind; to: readonly EquipmentKind[]; label: string }> = {
  feed: { from: "conveyor", to: ["robot", "amr"], label: "공급" },
  load: { from: "robot", to: ["pallet"], label: "적재" },
  pickup: { from: "amr", to: ["pallet"], label: "픽업" },
  deliver: { from: "pallet", to: ["dock", "rack", "conveyor"], label: "출고" },
  /** AMR → forklift that lifts its emptied pallet off / palletSource dock it is stacked on (else nearest). */
  emptyReturn: { from: "amr", to: ["amr", "dock"], label: "빈 팔레트 회수" },
};

export const LINKABLE_KINDS: ReadonlySet<EquipmentKind> = new Set(
  Object.values(LINK_RULES).flatMap((rule) => [rule.from, ...rule.to]),
);

/** Link type for `from -> to`, or null when the pair cannot be linked in that direction. */
export function linkTypeFor(from: EquipmentKind, to: EquipmentKind): LinkType | null {
  for (const [type, rule] of Object.entries(LINK_RULES) as [LinkType, (typeof LINK_RULES)[LinkType]][])
    if (rule.from === from && rule.to.includes(to)) return type;
  return null;
}

/** Ordered link between two kinds picked in any order; null when they cannot be linked. */
export function resolveLink(a: { id: string; kind: EquipmentKind }, b: { id: string; kind: EquipmentKind }) {
  const forward = linkTypeFor(a.kind, b.kind);
  if (forward) return { type: forward, from: a.id, to: b.id };
  const backward = linkTypeFor(b.kind, a.kind);
  return backward ? { type: backward, from: b.id, to: a.id } : null;
}

/** Outgoing/incoming lookups by link type, built once per run. */
export class LinkIndex {
  private out = new Map<string, string[]>();
  private in = new Map<string, string[]>();
  constructor(links: readonly SceneLink[]) {
    for (const link of links) {
      const o = `${link.type}:${link.from}`, i = `${link.type}:${link.to}`;
      this.out.set(o, [...(this.out.get(o) ?? []), link.to]);
      this.in.set(i, [...(this.in.get(i) ?? []), link.from]);
    }
  }
  outgoing(id: string, type: LinkType): readonly string[] { return this.out.get(`${type}:${id}`) ?? []; }
  incoming(id: string, type: LinkType): readonly string[] { return this.in.get(`${type}:${id}`) ?? []; }
}