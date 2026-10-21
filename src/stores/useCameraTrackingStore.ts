import { create } from "zustand";
import { useSceneStore } from "@/stores/useSceneStore";
import { useCargoStore } from "@/stores/useCargoStore";

interface CameraTrackingState {
  /** Scene object id the camera follows; null = free camera. */
  trackedId: string | null;
  track: (id: string | null) => void;
  toggle: (id: string) => void;
}

export const useCameraTrackingStore = create<CameraTrackingState>((set, get) => ({
  trackedId: null,
  // Tracking is a Play-mode feature: edit mode never starts it.
  track: (trackedId) => {
    if (trackedId && useSceneStore.getState().editing) trackedId = null;
    if (get().trackedId !== trackedId) set({ trackedId });
  },
  toggle: (id) => get().track(get().trackedId === id ? null : id),
}));

// Entering edit mode, deleting the tracked object (or clearing / replacing the layout) releases tracking.
useSceneStore.subscribe((scene) => {
  const { trackedId, track } = useCameraTrackingStore.getState();
  if (trackedId && (scene.editing || (!scene.objects.some((object) => object.id === trackedId) && !useCargoStore.getState().registry?.box(trackedId)))) track(null);
});
