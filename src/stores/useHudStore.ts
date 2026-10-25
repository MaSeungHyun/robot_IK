import { create } from "zustand";
import { useSceneStore } from "@/stores/useSceneStore";
import type { InspectorTab, WorkspaceMode } from "@/types/hud";

interface HudState {
  inspectorTab: InspectorTab | null;
  selectWorkspaceMode: (mode: WorkspaceMode) => void;
  /** Open asset-rail flyout (category or "templates"); kept in the store so placement, selection, undo/redo
   *  and HUD remounts never close it. */
  assetFlyout: string | null;
  setAssetFlyout: (id: string | null) => void;
  toggleInspectorTab: (tab: InspectorTab) => void;
  selectInspectorTab: (tab: InspectorTab) => void;
}

export const useHudStore = create<HudState>((set) => ({
  inspectorTab: "equipments",
  assetFlyout: null,
  setAssetFlyout: (assetFlyout) => set({ assetFlyout }),
  selectWorkspaceMode: (mode) => {
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
