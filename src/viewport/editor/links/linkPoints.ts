import type { SceneEquipment } from "@/types/layout";
import { beltLength, beltPoint } from "@/domain/conveyor/conveyorLayout";

/** brand-primary (tailwind `brand-primary`) for 3D link markers and paths. */
export const LINK_COLOR = "#02dfef";

/** Floor point where an equipment takes part in links: belt pick zone, robot base, station/dock centre. */
export function linkPoint(object: SceneEquipment) {
  if (object.kind === "conveyor") {
    const p = beltPoint(object, beltLength(object) / 2);
    return { x: p.x, z: p.z };
  }
  return { x: object.x, z: object.z };
}