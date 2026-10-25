import { create } from "zustand";

/** First-person walk mode (play only). Transient: never persisted. */
interface WalkModeState {
  active: boolean;
  setActive: (active: boolean) => void;
  toggle: () => void;
}

export const useWalkModeStore = create<WalkModeState>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
  toggle: () => set((state) => ({ active: !state.active })),
}));
