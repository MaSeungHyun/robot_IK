import { create } from "zustand";
import { useSceneStore } from "@/stores/useSceneStore";
import { useModeStore } from "@/stores/useModeStore";
import type { InspectorTab, WorkspaceMode } from "@/types/hud";

interface HudState {
  inspectorTab: InspectorTab | null;
  selectWorkspaceMode: (mode: WorkspaceMode) => void;
  toggleInspectorTab: (tab: InspectorTab) => void;
  selectInspectorTab: (tab: InspectorTab) => void;
}

export const useHudStore = create<HudState>((set) => ({
  inspectorTab: "equipments",
  selectWorkspaceMode: (mode) => {
    if (useModeStore.getState().mode !== "simulation") return;
    const scene = useSceneStore.getState();
    const currentMode = scene.editing ? "edit" : "play";
    if (mode === currentMode) {
      scene.setPending(null);
      return;
    }
    if (mode === "edit") {
      scene.edit();
    } else {
      scene.complete();
      if (useSceneStore.getState().editing) return;
    }
    scene.setPending(null);
    set({ inspectorTab: "equipments" });
  },
  toggleInspectorTab: (tab) => set((state) => ({
    inspectorTab: state.inspectorTab === tab ? null : tab,
  })),
  selectInspectorTab: (tab) => set({ inspectorTab: tab }),
}));
