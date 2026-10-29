import { create } from "zustand";

/** Startup warm-up phase shown on the loading screen (set by ModelWarmup). */
export type WarmupPhase = "idle" | "shaders" | "lighting" | "post";

/** Startup readiness: models parsed, shaders (incl. ghosts) compiled. */
export const useWarmupStore = create<{ ready: boolean; phase: WarmupPhase; setPhase: (phase: WarmupPhase) => void; setReady: () => void }>((set) => ({
  ready: false,
  phase: "idle",
  setPhase: (phase) => set({ phase }),
  setReady: () => set({ ready: true }),
}));
