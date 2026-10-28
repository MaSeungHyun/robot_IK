import { useHudStore } from "@/stores/useHudStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import { useTemplateLoadStore } from "@/stores/useTemplateLoadStore";
import type { SceneTemplate } from "@/types/sceneTemplate";

export function applySceneTemplate(template: SceneTemplate, run = false) {
  if (!useSceneStore.getState().loadTemplate(template)) return false;
  if (run && !useTemplateLoadStore.getState().active) {
    useHudStore.getState().selectWorkspaceMode("play");
    if (useSceneStore.getState().editing) return false;
    useSimulationStore.getState().setRunning(true);
  }
  return true;
}
