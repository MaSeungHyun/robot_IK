import type { EquipmentKind, EquipmentSettings } from "@/types/layout";

/**
 * Settings of a newly placed object (editor `add`), unified with template 06-factory-glb-v2 (most common value per type).
 * Applied under the asset-rail preset, so a preset still wins. Loaded templates/saved scenes are not affected.
 */
/** Robot pick / scanner belts (no conveyorRole): 0.25 m/s, as every such belt in template 06. */
export const PICK_BELT_SPEED = 0.25;
/** Inbound / outbound / ship belts: 1 m/s, as in template 06. */
export const ROLE_BELT_SPEED = 1;

export function placementDefaults(kind: EquipmentKind, preset?: Partial<EquipmentSettings> | null): Partial<EquipmentSettings> {
  if (kind === "conveyor") {
    const role = preset?.conveyorRole;
    return { autoSpawn: false, stopper: true, beltSpeed: role === "inbound" || role === "outbound" || role === "ship" ? ROLE_BELT_SPEED : PICK_BELT_SPEED };
  }
  // Template 06 doors are all open (8/8).
  if (kind === "door") return { doorOpen: true };
  // New robots pick every grade (전체) and also unscanned boxes; asset presets override pickFilter.
  if (kind === "robot") return { pickFilter: "all", pickUnscanned: true };
  return {};
}
