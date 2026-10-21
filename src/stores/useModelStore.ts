import { create } from "zustand";
import type { Group } from "three";
import { MODEL_URLS } from "@/viewport/models/modelUrls";

/** Startup model loading: each URL resolves to its scene, or null when it failed / timed out. */
export const useModelStore = create<{
  scenes: Record<string, Group | null>;
  report: (url: string, scene: Group | null) => void;
}>((set) => ({
  scenes: {},
  report: (url, scene) =>
    set((state) => (url in state.scenes ? {} : { scenes: { ...state.scenes, [url]: scene } })),
}));

/** True once every startup model either loaded or failed. */
export const useModelsSettled = () =>
  useModelStore((state) => MODEL_URLS.every((url) => url in state.scenes));
