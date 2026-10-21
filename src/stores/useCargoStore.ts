import { create } from "zustand";
import type { CargoRegistry } from "@/domain/cargo/CargoRegistry";
import { useSceneStore } from "@/stores/useSceneStore";

interface CargoState {
  /** Registry of the running simulation (null in edit mode / after STOP). */
  registry: CargoRegistry | null;
  /** Throttled copy of registry.version: the only thing that re-renders cargo UI. */
  version: number;
  selectedBoxId: string | null;
  setRegistry: (registry: CargoRegistry | null) => void;
  /** Called at the HUD report rate; no-op when nothing changed. */
  refresh: () => void;
  selectBox: (id: string | null) => void;
}

export const useCargoStore = create<CargoState>((set, get) => ({
  registry: null,
  version: 0,
  selectedBoxId: null,
  setRegistry: (registry) => set({ registry, version: registry?.version ?? 0, selectedBoxId: null }),
  refresh: () => {
    const registry = get().registry;
    if (registry && registry.version !== get().version) set({ version: registry.version });
  },
  selectBox: (selectedBoxId) => {
    if (selectedBoxId) useSceneStore.getState().select(null);
    if (get().selectedBoxId !== selectedBoxId) set({ selectedBoxId });
  },
}));

// Selecting/inspecting equipment, or returning to edit mode, clears the box selection.
useSceneStore.subscribe((scene, previous) => {
  const { selectedBoxId, selectBox } = useCargoStore.getState();
  if (!selectedBoxId) return;
  if (scene.editing || (scene.selected && scene.selected !== previous.selected) || (scene.inspected && scene.inspected !== previous.inspected))
    selectBox(null);
});
