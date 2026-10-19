import { useModeStore } from "@/stores/useModeStore";
import { useHudStore } from "@/stores/useHudStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import type { SceneTemplate } from "@/types/sceneTemplate";

export function applySceneTemplate(template: SceneTemplate, run = false) {
  if (useModeStore.getState().mode !== "simulation") return false;
  if (!useSceneStore.getState().loadTemplate(template)) return false;
  if (run) {
    useHudStore.getState().selectWorkspaceMode("play");
    if (useSceneStore.getState().editing) return false;
    useSimulationStore.getState().setRunning(true);
  }
  return true;
}
