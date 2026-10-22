import { selectedIds, useSceneStore } from "@/stores/useSceneStore";
import type { EquipmentKind, EquipmentSettings } from "@/types/layout";

// Keep UI edits behind this entry point so a future control transport can
// handle commands and acknowledgements without changing the setting fields.
export function applyEquipmentSettings(id: string, values: Partial<EquipmentSettings>) {
  const scene = useSceneStore.getState();
  if (!scene.settings[id]) return false;
  scene.updateSettings(id, values);
  return true;
}

export type SettingsPatch = (config: EquipmentSettings, id: string) => Partial<EquipmentSettings>;

/** Applies `patch` to `ids` as one undo step (a single id keeps the regular per-object path). Returns the changed count. */
export function applyToIds(ids: string[], patch: SettingsPatch) {
  const state = useSceneStore.getState();
  if (ids.length === 1) {
    const config = state.settings[ids[0]];
    return config && applyEquipmentSettings(ids[0], patch(config, ids[0])) ? 1 : 0;
  }
  return state.updateSettingsMany(ids, patch);
}

/** Every scene object of `kind` (optionally filtered), in scene order. */
export function idsOfKind(kind: EquipmentKind, filter?: (id: string) => boolean) {
  return useSceneStore.getState().objects.filter((o) => o.kind === kind && (!filter || filter(o.id))).map((o) => o.id);
}
/**
 * Settings targets for `id`: the whole multi-selection when `id` is its primary and every selected
 * object has the same kind (bulk edit), otherwise just `id`.
 */
export function bulkTargets(state: ReturnType<typeof useSceneStore.getState>, id: string): string[] {
  if (state.selected !== id) return [id];
  const ids = selectedIds(state);
  const kind = state.objects.find((o) => o.id === id)?.kind;
  return ids.length > 1 && ids.every((other) => state.objects.find((o) => o.id === other)?.kind === kind) ? ids : [id];
}
