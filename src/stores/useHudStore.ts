import { create } from "zustand";
import { useSceneStore } from "@/stores/useSceneStore";
import { useModeStore } from "@/stores/useModeStore";
import type { InspectorTab, LibraryTab, WorkspaceMode } from "@/types/hud";

interface HudState {
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  workspacePanelOpen: boolean;
  inspectorTab: InspectorTab | null;
  selectWorkspaceMode: (mode: WorkspaceMode) => void;
  closeWorkspacePanel: () => void;
  toggleInspectorTab: (tab: InspectorTab) => void;
  selectInspectorTab: (tab: InspectorTab) => void;
}

export const useHudStore = create<HudState>((set, get) => ({
  libraryTab: "asset",
  setLibraryTab: (tab) => {
    useSceneStore.getState().setPending(null);
    set({ libraryTab: tab });
  },
  workspacePanelOpen: true,
  inspectorTab: "equipments",
  selectWorkspaceMode: (mode) => {
    if (useModeStore.getState().mode !== "simulation") return;
    const scene = useSceneStore.getState();
    const currentMode = scene.editing ? "edit" : "play";
    if (mode === currentMode) {
      scene.setPending(null);
      set({ workspacePanelOpen: !get().workspacePanelOpen });
      return;
    }
    if (mode === "edit") {
      scene.edit();
    } else {
      scene.complete();
      if (useSceneStore.getState().editing) return;
    }
    scene.setPending(null);
    set({ workspacePanelOpen: true, inspectorTab: "equipments" });
  },
  closeWorkspacePanel: () => {
    useSceneStore.getState().setPending(null);
    set({ workspacePanelOpen: false });
  },
  toggleInspectorTab: (tab) => set((state) => ({
    inspectorTab: state.inspectorTab === tab ? null : tab,
  })),
  selectInspectorTab: (tab) => set({ inspectorTab: tab }),
}));
