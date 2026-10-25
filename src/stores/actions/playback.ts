import { markPlayRequested } from "@/domain/simulation/simulationClock";
import { useHudStore } from "@/stores/useHudStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { useSimulationStore } from "@/stores/useSimulationStore";

/** Stopped = editor. Play validates the layout, leaves the editor and runs at once; from pause it resumes. */
export function play() {
  if (!useSimulationStore.getState().running) markPlayRequested();
  if (useSceneStore.getState().editing) {
    useHudStore.getState().selectWorkspaceMode("play");
    // Validation errors keep the editor open (shown in the editor panel).
    if (useSceneStore.getState().editing) return false;
  }
  useSimulationStore.getState().setRunning(true);
  return true;
}

export function pause() {
  useSimulationStore.getState().setRunning(false);
}

/** Stops and resets the run and returns to the editor (which also releases camera tracking). */
export function stop() {
  if (useSceneStore.getState().editing) return;
  useHudStore.getState().selectWorkspaceMode("edit");
}
