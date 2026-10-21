import { create } from "zustand";

/** Startup readiness: models parsed, shaders (incl. ghosts) compiled. */
export const useWarmupStore = create<{ ready: boolean; setReady: () => void }>((set) => ({
  ready: false,
  setReady: () => set({ ready: true }),
}));
