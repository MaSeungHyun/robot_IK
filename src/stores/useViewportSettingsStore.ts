import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShadowQuality = "off" | "low" | "high";

interface ViewportSettingsState {
  shadowQuality: ShadowQuality;
  setShadowQuality: (quality: ShadowQuality) => void;
}

export const useViewportSettingsStore = create<ViewportSettingsState>()(
  persist(
    (set) => ({
      shadowQuality: "high",
      setShadowQuality: (shadowQuality) => set({ shadowQuality }),
    }),
    { name: "smart-factory-viewport-settings" },
  ),
);
