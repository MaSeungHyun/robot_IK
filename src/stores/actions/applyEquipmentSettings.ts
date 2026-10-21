import { useModeStore } from "@/stores/useModeStore";
import { useSceneStore } from "@/stores/useSceneStore";
import type { EquipmentSettings } from "@/types/layout";

// Keep UI edits behind this entry point so a future control transport can
// handle commands and acknowledgements without changing the setting fields.
export function applyEquipmentSettings(id: string, values: Partial<EquipmentSettings>) {
  if (useModeStore.getState().mode !== "simulation") return false;
  const scene = useSceneStore.getState();
  if (!scene.settings[id]) return false;
  scene.updateSettings(id, values);
  return true;
}
