import { isForkliftRole, type EquipmentSettings, type SceneEquipment } from "@/types/layout";
import { linkTypeFor, type LinkType, type SceneLink } from "@/types/links";

type Scene = {
  objects: readonly SceneEquipment[];
  settings: Record<string, EquipmentSettings | undefined>;
};

const roleOf = (id: string, settings: Scene["settings"]) => settings[id]?.amrRole;
const isFork = (id: string, settings: Scene["settings"]) => isForkliftRole(roleOf(id, settings));
const isAgv = (id: string, settings: Scene["settings"]) => roleOf(id, settings) === "agv";
const isShip = (id: string, settings: Scene["settings"]) => roleOf(id, settings) === "ship";
const isMobileRack = (id: string, settings: Scene["settings"]) => settings[id]?.rackType === "mobile";
/** Pallet / shuttle AMR (and ship where pickup/deliver allow): not forklift, not AGV. */
const isPalletAmr = (id: string, settings: Scene["settings"]) =>
  !isFork(id, settings) && !isAgv(id, settings);

/**
 * Role-aware link check on top of LINK_RULES kinds.
 * - AGV `store` → 이동식 랙만
 * - `emptyReturn` amr→amr → 일반/셔틀 AMR → 지게차만
 * - `deliver`/`feed`/`pickup` 대상에서 지게차·AGV 제외
 * - `collect` → 지게차만, `handoff` → 출하 AMR만
 */
export function isSceneLinkAllowed(
  link: { type: LinkType; from: string; to: string },
  { objects, settings }: Scene,
): boolean {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const from = byId.get(link.from), to = byId.get(link.to);
  if (!from || !to) return false;
  if (linkTypeFor(from.kind, to.kind) !== link.type) return false;

  switch (link.type) {
    case "emptyReturn":
      if (from.kind !== "amr") return false;
      if (isAgv(from.id, settings)) return false;
      if (to.kind === "dock") return true;
      // 셔틀·팔레트 AMR → 지게차 (만재 교체 담당 + 빈 회수)
      return to.kind === "amr" && isPalletAmr(from.id, settings) && isFork(to.id, settings);
    case "store":
      if (from.kind !== "amr" || to.kind !== "rack") return false;
      if (isAgv(from.id, settings)) return isMobileRack(to.id, settings);
      return isFork(from.id, settings);
    case "deliver":
      if (to.kind === "amr") return isPalletAmr(to.id, settings);
      return true;
    case "feed":
      if (to.kind === "amr") return isPalletAmr(to.id, settings);
      return true;
    case "pickup":
      if (from.kind === "amr") return isPalletAmr(from.id, settings) || isShip(from.id, settings);
      return true;
    case "collect":
      if (to.kind === "amr") return isFork(to.id, settings);
      return to.kind === "dock";
    case "handoff":
      return from.kind === "amr" && isShip(from.id, settings) && to.kind === "conveyor";
    default:
      return true;
  }
}

/** Drop links that fail kind or role rules (role change / template load). */
export function pruneInvalidLinks(links: readonly SceneLink[], scene: Scene): SceneLink[] {
  return links.filter((link) => isSceneLinkAllowed(link, scene));
}
