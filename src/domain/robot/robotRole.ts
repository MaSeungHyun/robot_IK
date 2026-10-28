import type { EquipmentSettings } from "@/types/layout";

/**
 * depalletize = UI 적재: pallet → belt (unscanned boxes, no grade). palletize = UI 하역: scanned belt boxes → pallet by grade.
 * Legacy 하역+grade robots are migrated to palletize in migrateSettings.
 */
export function isDepalletizer(config: EquipmentSettings | undefined) {
  return config?.robotRole === "depalletize";
}
