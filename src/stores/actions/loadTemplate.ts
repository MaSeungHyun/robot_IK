import { applySceneTemplate } from "@/stores/actions/applySceneTemplate";
import { useSceneStore } from "@/stores/useSceneStore";
import { useTemplateLoadStore } from "@/stores/useTemplateLoadStore";
import { useViewportSettingsStore } from "@/stores/useViewportSettingsStore";
import type { SceneTemplate } from "@/types/sceneTemplate";
import { dropInSchedule, holdDropIn, scheduleLoadDropIn } from "@/viewport/editor/dropIn";
import { groupPropsBySource } from "@/viewport/props/propSources";

/**
 * Template load with a progressive reveal (like the auto-layout): GLB props build in chunks over frames
 * (GlbProps), equipment waits until the structure chunk is on screen, then drops in by load order.
 * Play stays blocked until everything is revealed (useTemplateLoadStore.active).
 */
export function loadTemplateProgressive(template: SceneTemplate) {
  if (!applySceneTemplate(template)) return false;
  const sources = groupPropsBySource(useSceneStore.getState().props).length;
  useTemplateLoadStore.getState().begin(sources);
  if (useViewportSettingsStore.getState().loadAnimation) holdDropIn(useSceneStore.getState().objects);
  else dropInSchedule.clear();
  if (!sources) releaseEquipment();
  return true;
}

/** Structure is visible (or there is none): start the equipment drop-in. Idempotent per load. */
export function releaseEquipment() {
  const load = useTemplateLoadStore.getState();
  if (!load.active || load.released) return;
  const now = performance.now();
  if (useViewportSettingsStore.getState().loadAnimation) {
    const { endsAt, stageAt } = scheduleLoadDropIn(useSceneStore.getState().objects, now);
    load.release(endsAt, stageAt);
  } else load.release(now, []);
  load.visible();
}
